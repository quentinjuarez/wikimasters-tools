const { test } = require("node:test");
const assert = require("node:assert");
const { createRegistry } = require("../src/registry.js");
const { createCollection } = require("../src/collection.js");
const logic = require("../src/logic.js");
const { createMemoryStore } = require("../src/store.js");

const spec = [["L", 3], ["UR", 7], ["SR", 20], ["R", 40], ["PC", 100], ["C", 350]];
let n = 0;
const server = spec.flatMap(([rarity, count]) =>
  Array.from({ length: count }, () => {
    n += 1;
    return { id: `o${n}`, card_id: `c${n}`, starred: false, tags: rarity === "C" && n % 7 === 0 ? [{ tag: { id: "tp", name: "Paris" } }] : [], card: { wikipedia_title: `Carte ${n}`, rarity } };
  }),
);

function setup(store = createMemoryStore()) {
  const requests = [];
  const fetchPage = async (page, { stats, tagId }) => {
    requests.push({ page, stats: Boolean(stats), tagId: tagId ?? null });
    const source = tagId ? server.filter((e) => e.tags.length) : server;
    const body = { collection: source.slice(page * 50, page * 50 + 50) };
    if (stats) {
      const counts = Object.fromEntries(spec.map(([r]) => [r, server.filter((e) => e.card.rarity === r).length]));
      Object.assign(body, { total: server.length, rarityCounts: counts, tagOptions: [{ id: "tp", name: "Paris", cardCount: server.filter((e) => e.tags.length).length }] });
    }
    return body;
  };
  const collection = createCollection({ store, logic, fetchPage, now: () => 42, sleep: async () => {}, jitter: () => 0 });
  const ctl = { progress: () => {}, shouldStop: () => false };
  return { collection, requests, store, ctl };
}

test("opening costs one request and syncing default rarities fetches only their pages", async () => {
  const { collection, requests, ctl } = setup();
  await collection.load();
  await collection.refreshStats();
  assert.deepStrictEqual(requests, [{ page: 0, stats: true, tagId: null }]);
  await collection.syncRarities(logic.DEFAULT_RARITIES, ctl);
  assert.deepStrictEqual(requests.slice(1).map((r) => r.page), [1]);
  assert.strictEqual(collection.cache().cards.length, 70);
  assert.strictEqual(logic.rarityStatus(collection.cache(), collection.stats().counts, "R"), "ok");
  assert.strictEqual(logic.rarityStatus(collection.cache(), collection.stats().counts, "C"), "missing");
});

test("the cache survives a restart and reopening needs one request only", async () => {
  const first = setup();
  await first.collection.load();
  await first.collection.refreshStats();
  await first.collection.syncRarities(["L"], first.ctl);

  const second = setup(first.store);
  await second.collection.load();
  assert.strictEqual(second.collection.cache().cards.length, 3);
  await second.collection.refreshStats();
  assert.strictEqual(second.requests.length, 1);
  assert.strictEqual(logic.rarityStatus(second.collection.cache(), second.collection.stats().counts, "L"), "ok");
});

test("an included tag is fetched directly, stopping at the first short page", async () => {
  const { collection, requests, ctl } = setup();
  await collection.load();
  await collection.refreshStats();
  const [tag] = collection.stats().options;
  await collection.syncTags([tag], ctl);
  assert.ok(requests.slice(1).every((r) => r.tagId === "tp"));
  assert.deepStrictEqual(requests.slice(1).map((r) => r.page), [0, 1]);
  assert.strictEqual(logic.tagStatus(collection.cache(), tag), "ok");
  assert.strictEqual(collection.cache().cards.filter((c) => c.tags.some((t) => t.id === "tp")).length, 50);
});

test("stopping a sync keeps the previous cache untouched", async () => {
  const { collection, ctl } = setup();
  await collection.load();
  await collection.refreshStats();
  await assert.rejects(collection.syncRarities(["SR", "R"], { ...ctl, shouldStop: () => true }), /interrompu/);
  assert.strictEqual(collection.cache().cards.length, 0);
});

test("registry maps accent-insensitive titles to ids and notifies on change only", () => {
  const registry = createRegistry();
  let calls = 0;
  registry.onChange(() => calls++);
  assert.strictEqual(registry.add([{ id: "c1", title: "Élysée", rarity: "SR" }, { id: "", title: "x" }]), true);
  assert.strictEqual(registry.idFor("  elysee "), "c1");
  assert.strictEqual(registry.add([{ id: "c1", title: "Élysée", rarity: "SR" }]), false);
  assert.strictEqual(registry.add([{ id: "c1", title: "Élysée", rarity: null }]), false);
  assert.strictEqual(calls, 1);
  assert.strictEqual(registry.get("c1").rarity, "SR");
});

test("saving writes only the cards that changed and deletes the ones that left", async () => {
  const writes = [];
  const store = createMemoryStore();
  const original = store.putMany;
  store.putMany = async (name, records) => (writes.push([name, records.length]), original(name, records));
  const { collection, ctl } = setup(store);
  await collection.load();
  await collection.refreshStats();
  await collection.syncRarities(["L", "UR"], ctl);
  assert.deepStrictEqual(writes.filter(([name]) => name === "cards"), [["cards", 10]]);

  writes.length = 0;
  await collection.dropCopies([collection.cache().cards[0].copies[0].id]);
  assert.deepStrictEqual(writes.filter(([name]) => name === "cards"), []);
  assert.strictEqual((await store.loadAll("cards")).length, 9);
  assert.strictEqual((await store.get("collection-meta")).rarities.L.serverCount, 2);

  await collection.syncRarities(["L"], ctl);
  assert.strictEqual((await store.loadAll("cards")).length, 10);
});
