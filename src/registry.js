(function (root) {
  const logic = typeof require !== "undefined" ? require("./logic.js") : root.WMT.logic;

  function createRegistry() {
    const byId = new Map();
    const byTitle = new Map();
    const listeners = new Set();
    const owned = new Map();

    function add(cards) {
      let changed = false;
      for (const card of cards) {
        if (!card?.id || !card?.title) continue;
        const known = byId.get(card.id);
        if (known && known.title === card.title && (known.rarity === card.rarity || !card.rarity)) continue;
        byId.set(card.id, { id: card.id, title: card.title, rarity: card.rarity ?? known?.rarity ?? null });
        byTitle.set(logic.normalize(card.title), card.id);
        changed = true;
      }
      if (changed) listeners.forEach((listener) => listener());
      return changed;
    }

    function addOwned(list) {
      for (const { cardId, ownedId, starred } of list) {
        if (!owned.has(cardId)) owned.set(cardId, new Map());
        owned.get(cardId).set(ownedId, { id: ownedId, starred: Boolean(starred) });
      }
    }

    return {
      add,
      addOwned,
      owned: (cardId) => [...(owned.get(cardId)?.values() ?? [])],
      dropOwned(cardId, ownedId) {
        owned.get(cardId)?.delete(ownedId);
      },
      get: (id) => byId.get(id),
      idFor: (title) => byTitle.get(logic.normalize(title)),
      size: () => byId.size,
      onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  }

  const exported = { createRegistry };
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  else {
    const wmt = (root.WMT = root.WMT || {});
    wmt.registry = createRegistry();
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
