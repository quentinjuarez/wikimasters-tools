(function (root) {
  const wmt = root.WMT;
  const { logic, ui } = wmt;
  const PAGE_SIZE = 24;
  const SITE_SORTS = { "Rareté": "rarity", Nom: "name", Favoris: "starred" };
  const NO_MATCH = "__no_match__";

  let view = null;
  let paintTimer = null;

  function siteContainer() {
    const grid = document.querySelector("h3")?.closest("div.flex.flex-wrap");
    return grid?.closest("div.scroll-mt-4") ?? null;
  }

  function build() {
    const state = { page: 1, signature: null };
    const note = ui.el("p", "wmt-muted");
    const summary = ui.el("p", "wmt-line");
    const tiles = ui.el("div", "wmt-tiles");
    const prev = ui.button("Précédent");
    const next = ui.button("Suivant");
    const pageLabel = ui.el("span", "wmt-muted");
    const pager = ui.el("div", "wmt-pager");
    pager.append(prev, pageLabel, next);
    const results = ui.el("div", "wmt-pv-results");
    results.hidden = true;
    results.append(note, summary, tiles, pager);

    function siteCriteria(cache, site) {
      const criteria = { text: site.text, rarities: site.rarities.length ? site.rarities : undefined };
      const labels = [];
      if (site.rarities.length) labels.push(`raretés ${site.rarities.join(", ")}`);
      if (site.text) labels.push(`recherche « ${site.text} »`);

      if (site.tag === logic.NO_TAG) {
        criteria.untagged = true;
        labels.push("sans étiquette");
      } else if (site.tag) {
        const keys = logic
          .mergeTags(...cache.cards.map((card) => card.tags))
          .filter((tag) => logic.normalize(tag.name) === logic.normalize(site.tag))
          .map((tag) => tag.id || tag.name);
        criteria.includeTags = keys.length ? keys : [NO_MATCH];
        labels.push(keys.length ? `étiquette ${site.tag}` : `étiquette ${site.tag} (absente du cache)`);
      }
      return { criteria, labels };
    }

    function render() {
      const site = wmt.filters.read();
      const on = site?.sort === wmt.filters.PRICE_SORT;
      results.hidden = !on;
      siteContainer()?.classList.toggle("wmt-site-hidden", on);
      if (!on) {
        state.signature = null;
        return;
      }
      if (tiles.querySelector('[data-state="busy"]')) return;

      const cache = wmt.collection.cache();
      const prices = wmt.prices.all();
      const { criteria, labels } = siteCriteria(cache, site);
      const cards = logic.filterCards(cache.cards, { ...criteria, sort: "price-desc" }, prices);
      const page = logic.paginate(cards, state.page, PAGE_SIZE);
      state.page = page.page;

      const synced = logic.RARITIES.filter((rarity) => cache.rarities[rarity]);
      const unpriced = cards.filter((card) => logic.priceFor(card, prices) === null).length;
      const noteText = cache.cards.length
        ? `Tri par prix, filtres du site appliqués : ${labels.join(" ; ") || "aucun"}. Cache : ${synced.join(", ") || "aucune rareté complète"}.`
        : "Aucune carte en cache : ouvre la pastille en bas de l'écran pour charger la collection.";
      const summaryText = `${ui.plural(page.total, "carte")} sur ${cache.cards.length} en cache${unpriced ? `, dont ${unpriced} sans prix (en fin de liste)` : ""}.`;

      const signature = JSON.stringify([
        noteText,
        summaryText,
        page.page,
        page.pages,
        wmt.sale.isVisible(),
        page.items.map((card) => [card.cardId, card.copies.length, logic.priceFor(card, prices), Boolean(prices[card.cardId])]),
      ]);
      if (signature === state.signature) return;
      state.signature = signature;

      note.textContent = noteText;
      summary.textContent = summaryText;
      tiles.replaceChildren();
      for (const card of page.items) tiles.append(tile(card, prices));
      pager.hidden = page.pages <= 1;
      pageLabel.textContent = `Page ${page.page} / ${page.pages}`;
      prev.disabled = page.page <= 1;
      next.disabled = page.page >= page.pages;
    }

    function tile(card, prices) {
      const price = logic.priceFor(card, prices);
      const node = ui.el("div", "card-frame wmt-tile");
      node.dataset.rarity = card.rarity ?? "";
      const top = ui.el("div", "wmt-tile-top");
      top.append(ui.el("span", "wmt-item-rarity", card.rarity ?? "?"), ui.el("span", "wmt-muted", card.copies.length > 1 ? `x${card.copies.length}` : ""));
      node.append(top, ui.el("div", "wmt-tile-title", card.title));

      if (price !== null) node.append(ui.el("strong", "wmt-tile-price", `${ui.format(price)} W`));
      else if (prices[card.cardId]) node.append(ui.el("strong", "wmt-tile-price", "? W"));
      else {
        const calculate = ui.button("Calculer", "wmt-primary");
        calculate.addEventListener("click", () => wmt.prices.request({ id: card.cardId, rarity: card.rarity, title: card.title }, "high", { front: true, manual: true }));
        node.append(calculate);
      }

      if (wmt.sale.isVisible()) node.append(wmt.sale.createButton(() => card.cardId, () => setTimeout(render, 600)));
      return node;
    }

    const changed = () => {
      state.page = 1;
      render();
    };
    prev.addEventListener("click", () => {
      state.page -= 1;
      render();
      results.scrollIntoView({ block: "start" });
    });
    next.addEventListener("click", () => {
      state.page += 1;
      render();
      results.scrollIntoView({ block: "start" });
    });
    wmt.filters.onChange(changed);

    return { results, render };
  }

  function syncPage(onCollection) {
    if (!onCollection) {
      if (view) {
        view.results.remove();
        view = null;
        document.querySelector(".wmt-site-hidden")?.classList.remove("wmt-site-hidden");
      }
      return;
    }
    const container = siteContainer();
    if (!container) return;
    view = view ?? build();
    if (!view.results.isConnected) container.insertAdjacentElement("beforebegin", view.results);
    view.render();
  }

  function refreshSoon() {
    if (!view || paintTimer) return;
    paintTimer = setTimeout(() => {
      paintTimer = null;
      view?.render();
    }, 300);
  }

  wmt.priceview = { syncPage, refreshSoon };
})(window);
