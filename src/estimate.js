(function (root) {
  const wmt = root.WMT;
  const { logic, ui, prices, collection, registry } = wmt;
  const STATS_MAX_AGE_MS = 10 * 60 * 1000;
  const PACE_WINDOW = 30;
  const STATUS_TITLES = {
    ok: "À jour",
    missing: "Pas encore chargée",
    changed: "A changé depuis la dernière synchronisation",
  };

  let panel = null;

  const cardsToRegistry = (cards) => cards.map((card) => ({ id: card.cardId, title: card.title, rarity: card.rarity }));

  function build() {
    const state = {
      stop: false,
      running: false,
      statsAt: 0,
      tagStates: new Map(),
      targetIds: new Set(),
    };

    const rarityBoxes = logic.RARITIES.map((rarity) => {
      const box = ui.el("input");
      box.type = "checkbox";
      box.checked = logic.DEFAULT_RARITIES.includes(rarity);
      box.setAttribute("aria-label", rarity);
      const count = ui.el("span", "wmt-pill-count");
      const label = ui.el("label", "wmt-pill");
      label.dataset.rarity = rarity;
      label.append(box, ui.el("span", "wmt-pill-name", rarity), count);
      return { rarity, box, label, count };
    });
    const text = ui.search("Rechercher une carte ou une étiquette");
    const tagRow = ui.el("div", "wmt-tags");
    const tagHint = ui.el("p", "wmt-muted", "Un clic pour inclure une étiquette, deux pour l'exclure.");

    const heroValue = ui.el("p", "wmt-hero-value");
    const heroSub = ui.el("p", "wmt-hero-sub");
    const spread = ui.el("div", "wmt-spread");
    const hero = ui.el("section", "card-frame wmt-card wmt-hero");
    hero.append(ui.el("p", "wmt-title", "Valeur estimée de la sélection"), heroValue, heroSub, spread);

    const planLine = ui.el("p", "wmt-line");
    const runBtn = ui.button("Estimer ma sélection", "wmt-primary wmt-run");
    const stopBtn = ui.button("Arrêter");
    stopBtn.hidden = true;
    const retryBtn = ui.button("");
    retryBtn.hidden = true;
    const bar = ui.progress();
    const message = ui.el("p", "wmt-muted wmt-progress-line");

    const advanced = ui.el("details", "card-frame wmt-card wmt-details");
    const advancedInfo = ui.el("p", "wmt-line");
    const fullBtn = ui.button("");
    const versionLine = ui.el("p", "wmt-muted");

    const speedAuto = ui.toggle("Rythme automatique", true);
    const speedRange = ui.el("input", "wmt-range");
    speedRange.type = "range";
    speedRange.min = "0";
    speedRange.max = "10000";
    speedRange.step = "100";
    speedRange.value = "1000";
    speedRange.setAttribute("aria-label", "Délai minimum entre deux requêtes");
    const speedLabel = ui.el("p", "wmt-muted");
    const speedBox = ui.el("div", "wmt-speed");
    speedBox.append(ui.el("p", "wmt-line", "Délai entre deux requêtes"), speedAuto.label, speedRange, speedLabel);
    advanced.append(ui.el("summary", "", "Réglages"), speedBox, advancedInfo, fullBtn, versionLine);

    const queueText = ui.el("span", "wmt-queue-text");
    const clearBtn = ui.button("Vider");
    const resumeBtn = ui.button("Reprendre");
    resumeBtn.title = "Ignorer la pause du site et relancer la file tout de suite";
    resumeBtn.hidden = true;
    const queueBox = ui.el("div", "card-frame wmt-card wmt-queue");
    queueBox.hidden = true;
    queueBox.append(ui.el("span", "wmt-dot"), queueText, resumeBtn, clearBtn);

    const panelRoot = ui.el("aside", "wmt-panel");
    panelRoot.setAttribute("aria-label", "Estimation de la collection");
    const closeBtn = ui.button("×", "wmt-close");
    closeBtn.setAttribute("aria-label", "Fermer");
    const head = ui.el("div", "wmt-head");
    head.append(ui.el("h2", "", "Estimer ma collection"), closeBtn);

    const block = (...children) => {
      const node = ui.el("section", "card-frame wmt-card wmt-block");
      node.append(...children);
      return node;
    };

    const pillRow = ui.el("div", "wmt-pills");
    pillRow.append(...rarityBoxes.map(({ label }) => label));
    const actions = ui.el("div", "wmt-row-actions");
    actions.append(runBtn, stopBtn, retryBtn);

    panelRoot.append(
      head,
      hero,
      block(pillRow, text, tagRow, tagHint),
      block(planLine, actions, bar.el, message),
      queueBox,
      advanced,
    );

    const tagList = () => {
      const cache = collection.cache();
      if (cache.tagOptions.length) return cache.tagOptions;
      return logic.mergeTags(...cache.cards.map((card) => card.tags)).map((tag) => ({ id: tag.id, name: tag.name, cardCount: null }));
    };
    const keysWith = (value) => [...state.tagStates].filter(([, current]) => current === value).map(([key]) => key);
    const criteria = () => ({
      text: text.value,
      rarities: rarityBoxes.filter(({ box }) => box.checked).map(({ rarity }) => rarity),
      includeTags: keysWith("include"),
      excludeTags: keysWith("exclude"),
    });
    const includedTags = () => tagList().filter((tag) => tag.id && state.tagStates.get(tag.id) === "include");
    const targetCards = () => logic.filterCards(collection.cache().cards, criteria());

    function syncJob() {
      const stats = collection.stats();
      if (!stats) return null;
      const cache = collection.cache();
      const tags = includedTags();
      if (tags.length) {
        const need = tags.filter((tag) => logic.tagStatus(cache, tag) !== "ok");
        const pages = need.reduce((sum, tag) => sum + Math.max(1, Math.ceil((tag.cardCount ?? 1) / logic.PAGE_SIZE)), 0);
        return need.length ? { kind: "tags", tags: need, pages } : null;
      }
      const need = criteria().rarities.filter((rarity) => logic.rarityStatus(cache, stats.counts, rarity) !== "ok");
      return need.length ? { kind: "rarities", rarities: need, pages: logic.rarityPages(stats.counts, need).length } : null;
    }

    const tagNext = { none: "include", include: "exclude", exclude: "none" };
    function renderTags() {
      tagRow.replaceChildren();
      const tags = tagList();
      tagHint.hidden = !tags.length;
      for (const tag of tags) {
        const key = tag.id || tag.name;
        const chip = ui.button(tag.name, "wmt-chip");
        if (tag.cardCount) chip.append(ui.el("span", "wmt-chip-count", String(tag.cardCount)));
        chip.dataset.state = state.tagStates.get(key) ?? "none";
        chip.addEventListener("click", () => {
          const next = tagNext[state.tagStates.get(key) ?? "none"];
          state.tagStates.set(key, next);
          chip.dataset.state = next;
          filtersChanged();
        });
        tagRow.append(chip);
      }
    }

    const RARITY_ORDER = logic.RARITIES;

    function renderHero() {
      const totals = logic.estimateTotals(targetCards(), prices.all());
      heroValue.textContent = `${ui.format(totals.value)} W`;
      const selected = totals.priced + totals.unpriced;
      heroSub.textContent = selected
        ? `${ui.plural(selected, "carte")} sélectionnée${selected > 1 ? "s" : ""}${totals.unpriced ? `, dont ${totals.unpriced} sans prix` : ""}.`
        : "Aucune carte dans la sélection.";
      spread.replaceChildren();
      for (const rarity of RARITY_ORDER) {
        const value = totals.byRarity[rarity];
        if (!value) continue;
        const part = ui.el("span", "wmt-spread-part");
        part.dataset.rarity = rarity;
        part.style.flexGrow = String(value);
        part.title = `${rarity} : ${ui.format(value)} W`;
        spread.append(part);
      }
      spread.hidden = !spread.children.length;
    }

    function renderPlan() {
      const stats = collection.stats();
      const cache = collection.cache();
      const job = syncJob();
      const toPrice = logic.selectForLoad(targetCards(), prices.all());
      const parts = [];
      if (job) parts.push(`charger ${ui.plural(job.pages, "page")} de ta collection`);
      if (toPrice.length) parts.push(`calculer ${ui.plural(toPrice.length, "prix")}`);
      const failed = prices.failedIds().filter((id) => targetCards().some((card) => card.cardId === id));

      if (!stats && !cache.cards.length) planLine.textContent = collection.statsError() ?? "Vérification de la collection en cours";
      else if (parts.length) planLine.textContent = `Il reste à ${parts.join(", puis à ")}.`;
      else planLine.textContent = "Tout est à jour pour cette sélection.";

      runBtn.disabled = state.running || (!job && !toPrice.length);
      retryBtn.hidden = state.running || !failed.length;
      retryBtn.textContent = `Réessayer ${ui.plural(failed.length, "échec")}`;

      const copies = cache.cards.reduce((sum, card) => sum + card.copies.length, 0);
      advancedInfo.textContent = cache.savedAt
        ? `En cache : ${ui.plural(copies, "exemplaire")} (${ui.plural(cache.cards.length, "carte")}), synchronisé il y a ${ui.age(cache.savedAt)}.`
        : "Rien en cache pour l'instant.";
      versionLine.textContent = `Version ${root.chrome?.runtime?.getManifest?.().version ?? "de développement"}`;
      fullBtn.hidden = !stats;
      if (stats) {
        fullBtn.textContent = `Tout resynchroniser (${ui.plural(Math.ceil(stats.total / logic.PAGE_SIZE), "page")})`;
        fullBtn.disabled = state.running;
      }

      for (const { rarity, label, count } of rarityBoxes) {
        const total = Number(stats?.counts?.[rarity]) || 0;
        count.textContent = total ? String(total) : "";
        const meta = cache.rarities[rarity];
        let status = total || meta ? logic.rarityStatus(cache, stats?.counts ?? {}, rarity) : "";
        if (status === "ok" && meta && meta.loaded < meta.serverCount) status = "changed";
        if (status) {
          label.dataset.sync = status;
          label.title = STATUS_TITLES[status];
        }
      }
    }

    function renderSpeed() {
      const status = prices.status();
      const seconds = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1).replace(".", ",")} s` : `${Math.round(ms)} ms`);
      const auto = status.manualGapMs === null;
      speedAuto.box.checked = auto;
      speedRange.disabled = auto;
      if (!auto) speedRange.value = String(status.manualGapMs);
      speedLabel.textContent = auto
        ? status.learnedGapMs ? `Rythme appris : ${seconds(status.learnedGapMs)} entre deux requêtes.` : "Aucun délai ajouté pour l'instant."
        : `${seconds(status.manualGapMs)} minimum entre deux requêtes.`;
    }

    function renderQueue() {
      renderSpeed();
      const status = prices.status();
      const waiting = status.active + status.queued;
      queueBox.hidden = !waiting && !status.cooldownMs;
      queueBox.dataset.state = status.cooldownMs ? "paused" : "busy";
      queueText.textContent = status.cooldownMs
        ? `Le site demande une pause, reprise dans ${Math.ceil(status.cooldownMs / 1000)} s.`
        : `${ui.plural(waiting, "prix")} en cours de calcul.`;
      clearBtn.hidden = !waiting;
      resumeBtn.hidden = !status.cooldownMs;
    }

    function refresh() {
      renderHero();
      renderPlan();
      renderQueue();
    }

    async function syncCollection(job) {
      const options = {
        progress: (done, total) => {
          bar.set(done / total);
          message.textContent = `Collection : ${done}/${total} pages`;
        },
        shouldStop: () => state.stop,
      };
      if (job.kind === "tags") await collection.syncTags(job.tags, options);
      else await collection.syncRarities(job.rarities, options);
      registry.add(cardsToRegistry(collection.cache().cards));
      renderTags();
    }

    async function calculate(targets) {
      state.targetIds = new Set(targets.map((card) => card.cardId));
      let settled = 0;
      let failed = 0;
      const startedAt = Date.now();
      let stamps = [];
      const timer = setInterval(() => {
        bar.set(settled / targets.length);
        message.textContent = logic.progressLine({
          done: settled,
          total: targets.length,
          failed,
          startedAt,
          stamps,
          now: Date.now(),
          pauseMs: prices.status().cooldownMs,
        });
      }, 400);

      await Promise.all(
        targets.map((card) => {
          const request = { id: card.cardId, rarity: card.rarity, title: card.title };
          const known = Boolean(prices.entry(card.cardId));
          const result = known ? prices.refresh(request, "low") : prices.request(request, "low");
          return result.then((outcome) => {
            settled += 1;
            stamps = [...stamps, Date.now()].slice(-PACE_WINDOW);
            if (outcome === "failed") failed += 1;
          });
        }),
      );
      clearInterval(timer);
      await prices.flush();
      bar.set(1);
      return { settled, failed };
    }

    async function run(task) {
      state.running = true;
      state.stop = false;
      stopBtn.hidden = false;
      message.textContent = "";
      bar.set(0);
      refresh();
      try {
        await task();
      } catch (error) {
        message.textContent = error.message;
      }
      state.running = false;
      stopBtn.hidden = true;
      refresh();
    }

    runBtn.addEventListener("click", () =>
      run(async () => {
        const job = syncJob();
        if (job) await syncCollection(job);
        if (state.stop) throw new Error("Arrêté");
        const targets = logic.selectForLoad(targetCards(), prices.all());
        if (!targets.length) {
          message.textContent = "Collection à jour, aucun prix à calculer.";
          return;
        }
        const { settled, failed } = await calculate(targets);
        message.textContent = `${settled - failed} prix calculés${failed ? `, ${failed} en échec (anciennes valeurs conservées)` : ""}.`;
      }),
    );

    retryBtn.addEventListener("click", () =>
      run(async () => {
        const ids = new Set(prices.failedIds());
        const { settled, failed } = await calculate(targetCards().filter((card) => ids.has(card.cardId)));
        message.textContent = `${settled - failed} prix calculés${failed ? `, ${failed} toujours en échec` : ""}.`;
      }),
    );

    fullBtn.addEventListener("click", () =>
      run(async () => {
        await syncCollection({ kind: "rarities", rarities: logic.RARITIES });
        message.textContent = "Collection resynchronisée.";
      }),
    );

    stopBtn.addEventListener("click", () => {
      state.stop = true;
      prices.cancel((card) => state.targetIds.has(card.id));
    });
    clearBtn.addEventListener("click", () => {
      state.stop = true;
      prices.cancel(() => true);
    });
    resumeBtn.addEventListener("click", () => {
      prices.skipPause();
      renderQueue();
    });
    const filtersChanged = () => refresh();
    const speedChanged = () => {
      prices.setMinInterval(speedAuto.box.checked ? null : Number(speedRange.value));
      renderSpeed();
    };
    speedBox.addEventListener("input", (event) => {
      event.stopPropagation();
      speedChanged();
    });
    speedBox.addEventListener("change", (event) => {
      event.stopPropagation();
      speedChanged();
    });
    panelRoot.addEventListener("input", filtersChanged);
    panelRoot.addEventListener("change", filtersChanged);

    let tick = null;
    let pendingPaint = null;
    const paintSoon = () => {
      if (panelRoot.dataset.open !== "true" || pendingPaint) return;
      pendingPaint = setTimeout(() => {
        pendingPaint = null;
        refresh();
      }, 250);
    };
    prices.onChange(paintSoon);

    const close = () => {
      panelRoot.dataset.open = "false";
      clearInterval(tick);
      tick = null;
    };
    closeBtn.addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && panelRoot.dataset.open === "true") close();
    });

    document.body.appendChild(panelRoot);
    renderTags();
    refresh();

    async function open() {
      panelRoot.dataset.open = "true";
      refresh();
      tick = tick ?? setInterval(renderQueue, 1000);
      if (Date.now() - state.statsAt > STATS_MAX_AGE_MS && !state.running) {
        state.statsAt = Date.now();
        await collection.refreshStats();
        renderTags();
        refresh();
      }
    }

    return { root: panelRoot, open, close, isOpen: () => panelRoot.dataset.open === "true" };
  }

  function toggle() {
    panel = panel ?? build();
    if (panel.isOpen()) panel.close();
    else panel.open();
  }

  wmt.estimate = { toggle };
})(window);
