(function (root) {
  const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function createCollection({
    store,
    logic,
    fetchPage,
    now = Date.now,
    sleep = defaultSleep,
    concurrency = 2,
    jitter = () => 150 + Math.random() * 250,
  }) {
    let cache = logic.emptyCache();
    let stats = null;
    let statsError = null;

    let saved = new Map();

    async function save() {
      const changed = cache.cards.filter((card) => saved.get(card.cardId) !== card);
      const present = new Set(cache.cards.map((card) => card.cardId));
      const removed = [...saved.keys()].filter((id) => !present.has(id));
      const { cards, ...meta } = cache;
      await Promise.all([
        changed.length && store.putMany("cards", changed),
        removed.length && store.deleteMany("cards", removed),
        store.set("collection-meta", meta),
      ]);
      saved = new Map(cache.cards.map((card) => [card.cardId, card]));
    }

    async function load() {
      const [cards, meta] = await Promise.all([store.loadAll("cards"), store.get("collection-meta")]);
      cache = { ...logic.emptyCache(), ...meta, cards };
      saved = new Map(cards.map((card) => [card.cardId, card]));
    }

    async function refreshStats() {
      try {
        const json = await fetchPage(0, { stats: true });
        const counts = json?.rarityCounts;
        if (!counts || typeof counts !== "object" || Array.isArray(counts)) throw new Error("statistiques indisponibles");
        const options = logic.mapTagOptions(json.tagOptions);
        const total = Number(json.total) || logic.RARITIES.reduce((sum, rarity) => sum + (Number(counts[rarity]) || 0), 0);
        stats = { json, counts, total, options };
        statsError = null;
        cache = { ...cache, tagOptions: options };
        await save();
      } catch (error) {
        statsError = `Collection injoignable : ${error.message}`;
      }
    }

    async function fetchPages(pages, { seed = {}, progress, shouldStop }) {
      const entries = [];
      let next = 0;
      let done = 0;

      const worker = async () => {
        while (next < pages.length && !shouldStop()) {
          const page = pages[next];
          next += 1;
          const json = seed[page] ?? (await fetchPage(page, {}));
          entries.push(...(Array.isArray(json?.collection) ? json.collection : []));
          done += 1;
          progress(done, pages.length);
          await sleep(jitter());
        }
      };

      await Promise.all(Array.from({ length: concurrency }, worker));
      if (shouldStop()) throw new Error("Chargement interrompu");
      return entries.map(logic.mapEntry).filter(Boolean);
    }

    async function syncRarities(rarities, { progress, shouldStop }) {
      const pages = logic.rarityPages(stats.counts, rarities);
      const mapped = await fetchPages(pages, { seed: { 0: stats.json }, progress, shouldStop });
      cache = logic.applyRaritySync(cache, mapped, rarities, stats.counts, now());
      await save();
    }

    async function syncTags(tags, { progress, shouldStop }) {
      const total = tags.reduce((sum, tag) => sum + Math.max(1, Math.ceil((tag.cardCount ?? 1) / logic.PAGE_SIZE)), 0);
      let done = 0;

      for (const tag of tags) {
        const entries = [];
        for (let page = 0; page < 400; page += 1) {
          if (shouldStop()) throw new Error("Chargement interrompu");
          const json = await fetchPage(page, { tagId: tag.id });
          const list = Array.isArray(json?.collection) ? json.collection : [];
          entries.push(...list);
          done += 1;
          progress(Math.min(done, total), total);
          if (list.length < logic.PAGE_SIZE) break;
          await sleep(jitter());
        }
        cache = logic.applyTagSync(cache, entries.map(logic.mapEntry).filter(Boolean), tag, now());
      }
      await save();
    }

    async function dropCopies(ownedIds) {
      cache = logic.removeCopies(cache, ownedIds);
      await save();
    }

    return {
      dropCopies,
      load,
      refreshStats,
      syncRarities,
      syncTags,
      cache: () => cache,
      stats: () => stats,
      statsError: () => statsError,
    };
  }

  function pageFetcher(api) {
    return (page, { stats = false, tagId = null }) => {
      const tag = tagId ? `&tag_id=${encodeURIComponent(tagId)}` : "";
      return api.fetchRetry(`/api/my-collection?sort=rarity${tag}&page=${page}&stats=${stats ? 1 : 0}`);
    };
  }

  const exported = { createCollection, pageFetcher };
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  else {
    const wmt = (root.WMT = root.WMT || {});
    wmt.collection = createCollection({ store: wmt.store, logic: wmt.logic, fetchPage: pageFetcher(wmt.api) });
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
