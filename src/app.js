(function (root) {
  const wmt = root.WMT;

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.source !== "wmt-hook") return;
    wmt.registry.add(wmt.logic.cardsFromPayload(data.path, data.json));
    wmt.registry.addOwned(wmt.logic.ownedFromPayload(data.path, data.json));
    wmt.bid.add(wmt.logic.auctionsFromPayload(data.path, data.json));
    wmt.badges.scan();
  });

  async function start() {
    await wmt.store.migrate();
    await Promise.all([wmt.prices.load(), wmt.sale.load(), wmt.prefs.load(), wmt.filters.load()]);
    wmt.badges.start();
    wmt.bar.mount();
    document.addEventListener("visibilitychange", () => document.hidden && wmt.prices.flush());
    window.addEventListener("pagehide", () => wmt.prices.flush());

    await wmt.collection.load();
    const { cards } = wmt.collection.cache();
    wmt.registry.add(cards.map((card) => ({ id: card.cardId, title: card.title, rarity: card.rarity })));
    wmt.registry.addOwned(
      cards.flatMap((card) => card.copies.map((copy) => ({ cardId: card.cardId, ownedId: copy.id, starred: copy.starred }))),
    );
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})(window);
