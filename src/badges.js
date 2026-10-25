(function (root) {
  const wmt = root.WMT;
  const CARD = 'div[class*="rounded-2xl"][class*="overflow-hidden"]';
  const RARITY = /^(L|UR|SR|R|PC|C)$/;
  const bound = new WeakMap();
  let observer = null;
  let scanTimer = null;

  function rarityOf(card) {
    for (const node of card.querySelectorAll("div")) {
      const text = node.textContent.trim();
      if (node.children.length === 0 && RARITY.test(text)) return text;
    }
    return null;
  }

  function paint(badge) {
    const { id, rarity } = badge.dataset;
    const value = wmt.prices.value(id, rarity);
    if (typeof value === "number") {
      badge.dataset.state = "ready";
      badge.textContent = `${wmt.ui.format(value)} W`;
      badge.title = `Prix moyen des ventes, calculé il y a ${wmt.ui.age(wmt.prices.entry(id).fetchedAt)}. Cliquer pour recalculer`;
    } else if (value === null) {
      badge.dataset.state = "none";
      badge.textContent = "? W";
      badge.title = "Aucune vente connue pour cette rareté. Cliquer pour recalculer";
    } else if (wmt.prices.hasFailed(id) && !wmt.prices.isPending(id)) {
      badge.dataset.state = "failed";
      badge.textContent = "Réessayer";
      badge.title = "Prix indisponible, cliquer pour réessayer";
    } else if (!wmt.prices.isPending(id) && !wmt.prefs.autoAllowed()) {
      badge.dataset.state = "idle";
      badge.textContent = "Calculer";
      badge.title = "Calcul automatique désactivé, cliquer pour calculer ce prix";
    } else {
      badge.dataset.state = "loading";
      badge.textContent = "W";
      badge.title = "Prix en attente";
    }
  }

  function bind(card) {
    const heading = card.querySelector("h3");
    if (!heading) return;
    const title = heading.textContent.trim();
    const known = bound.get(card);
    if (known && known.title === title && known.badge.isConnected) return;

    const id = wmt.registry.idFor(title);
    if (!id) return;
    const rarity = rarityOf(card) ?? wmt.registry.get(id)?.rarity ?? null;
    if (!rarity) return;

    let badge = known?.badge;
    if (!badge || !badge.isConnected) {
      badge = document.createElement("span");
      badge.className = "wmt-badge";
      card.appendChild(badge);
    }
    badge.dataset.id = id;
    badge.dataset.rarity = rarity;
    bound.set(card, { title, badge, requested: false });
    paint(badge);
    observer.observe(card);
  }

  function guarded(step) {
    try {
      step();
    } catch (error) {
      console.error("[WikiMaster Tools]", error);
    }
  }

  function scan() {
    scanTimer = null;
    if (!observer) return;
    const onCollection = location.pathname.startsWith("/collection");
    for (const heading of document.querySelectorAll("h3")) {
      const card = heading.closest(CARD);
      if (!card) continue;
      guarded(() => {
        bind(card);
        if (onCollection && bound.has(card)) wmt.sale.decorate(card);
        if (bound.has(card)) wmt.bid.decorate(card, bound.get(card).title);
      });
    }
    guarded(() => wmt.prefs.syncPage());
    guarded(() => wmt.sale.syncPage(onCollection));
    guarded(() => wmt.priceview.syncPage(onCollection));
  }

  function scheduleScan() {
    if (!scanTimer) scanTimer = setTimeout(scan, 150);
  }

  function onIntersect(entries) {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const state = bound.get(entry.target);
      observer.unobserve(entry.target);
      if (!state || state.requested || !wmt.prefs.autoAllowed()) continue;
      state.requested = true;
      const { id, rarity } = state.badge.dataset;
      wmt.prices.request({ id, rarity, title: state.title }, "high", { front: wmt.prefs.isDetail() });
    }
  }

  function onRetryClick(event) {
    const badge = event.target.closest?.('.wmt-badge[data-state="failed"], .wmt-badge[data-state="idle"], .wmt-badge[data-state="ready"], .wmt-badge[data-state="none"]');
    if (!badge) return;
    event.preventDefault();
    event.stopPropagation();
    const { id, rarity } = badge.dataset;
    wmt.prices.refresh({ id, rarity, title: wmt.registry.get(id)?.title }, "high", { front: true, manual: true });
    paint(badge);
  }

  function refreshAll() {
    for (const badge of document.querySelectorAll(".wmt-badge")) {
      const card = badge.parentElement;
      const state = card && bound.get(card);
      if (state) {
        state.requested = false;
        observer.observe(card);
      }
      paint(badge);
    }
  }

  function start() {
    document.addEventListener("click", onRetryClick, true);
    observer = new IntersectionObserver(onIntersect, { rootMargin: "200px 0px" });
    new MutationObserver(scheduleScan).observe(document.body, { childList: true, subtree: true });
    wmt.registry.onChange(scheduleScan);
    wmt.prices.onChange((id) => {
      wmt.priceview.refreshSoon();
      for (const badge of document.querySelectorAll(".wmt-badge")) {
        if (id === null || badge.dataset.id === id) paint(badge);
      }
    });
    document.addEventListener("visibilitychange", scheduleScan);
    scan();
  }

  function stateOf(card) {
    const state = bound.get(card);
    if (!state) return null;
    return { id: state.badge.dataset.id, rarity: state.badge.dataset.rarity, title: state.title };
  }

  wmt.badges = { start, scan, stateOf, refreshAll };
})(window);
