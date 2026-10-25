const { test } = require("node:test");
const assert = require("node:assert");
const { IDBFactory } = require("fake-indexeddb");
const { createIdbStore, createMemoryStore, migrate } = require("../src/store.js");

test("kv and tables round trip through IndexedDB, and a new session reads what the previous one wrote", async () => {
  const idb = new IDBFactory();
  const first = createIdbStore(idb);
  await first.set("sale", { amount: 5 });
  await first.putMany("prices", [{ id: "a", averages: { R: 1 } }, { id: "b", averages: { R: 2 } }]);
  await first.putMany("prices", [{ id: "a", averages: { R: 9 } }]);
  await first.deleteMany("prices", ["b"]);

  const second = createIdbStore(idb);
  assert.deepStrictEqual(await second.get("sale"), { amount: 5 });
  assert.deepStrictEqual(await second.loadAll("prices"), [{ id: "a", averages: { R: 9 } }]);
  assert.strictEqual(await second.get("missing"), undefined);
  await second.del("sale");
  assert.strictEqual(await createIdbStore(idb).get("sale"), undefined);
});

test("the old single-object layout (version 1) is upgraded and migrated once", async () => {
  const idb = new IDBFactory();
  await new Promise((resolve, reject) => {
    const request = idb.open("wmt", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("kv");
    request.onsuccess = () => {
      const tx = request.result.transaction("kv", "readwrite");
      tx.objectStore("kv").put({ c1: { averages: { R: 5 }, fetchedAt: 1, title: "A", rarity: "R" } }, "prices");
      tx.objectStore("kv").put({ cards: [{ cardId: "c1", title: "A", rarity: "R", copies: [], tags: [] }], rarities: { R: { serverCount: 1 } }, savedAt: 7 }, "collection");
      tx.oncomplete = () => {
        request.result.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
  });

  const store = createIdbStore(idb);
  await migrate(store);
  assert.deepStrictEqual(await store.loadAll("prices"), [{ id: "c1", averages: { R: 5 }, fetchedAt: 1, title: "A", rarity: "R" }]);
  assert.strictEqual((await store.loadAll("cards")).length, 1);
  assert.deepStrictEqual(await store.get("collection-meta"), { rarities: { R: { serverCount: 1 } }, savedAt: 7 });
  assert.strictEqual(await store.get("prices"), undefined);
  assert.strictEqual(await store.get("collection"), undefined);

  await migrate(store);
  assert.strictEqual((await store.loadAll("prices")).length, 1);
});

test("without IndexedDB the store keeps working in memory", async () => {
  const broken = { open: () => ({}) };
  const store = createIdbStore({ open: () => { throw new Error("no idb"); } });
  await store.set("k", 1);
  await store.putMany("cards", [{ cardId: "x" }]);
  assert.strictEqual(await store.get("k"), 1);
  assert.deepStrictEqual(await store.loadAll("cards"), [{ cardId: "x" }]);
  assert.ok(createMemoryStore());
  assert.ok(broken);
});

const fakeArea = (initial = {}) => {
  const data = { ...initial };
  return {
    data,
    get: async (key) => (key === null ? { ...data } : { [key]: data[key] }),
    set: async (changes) => void Object.assign(data, changes),
    remove: async (keys) => void keys.forEach((key) => delete data[key]),
  };
};

test("extension store keeps kv and tables in extension storage", async () => {
  const { createExtensionStore } = require("../src/store.js");
  const area = fakeArea();
  const store = createExtensionStore(area);
  await store.set("sale", { amount: 5 });
  await store.putMany("prices", [{ id: "a", averages: { R: 1 } }, { id: "b", averages: { C: 2 } }]);
  await store.deleteMany("prices", ["b"]);
  assert.deepStrictEqual(await store.get("sale"), { amount: 5 });
  assert.deepStrictEqual(await store.loadAll("prices"), [{ id: "a", averages: { R: 1 } }]);
  const reopened = createExtensionStore(area);
  assert.deepStrictEqual(await reopened.loadAll("prices"), [{ id: "a", averages: { R: 1 } }]);
});

test("extension store imports the old page database once", async () => {
  const { createExtensionStore, createIdbStore } = require("../src/store.js");
  const { IDBFactory } = require("fake-indexeddb");
  const legacy = createIdbStore(new IDBFactory());
  await legacy.set("filters", { text: "x" });
  await legacy.putMany("prices", [{ id: "a", averages: { R: 9 } }]);
  await legacy.putMany("cards", [{ cardId: "a", title: "A" }]);
  const area = fakeArea();
  const store = createExtensionStore(area, legacy);
  assert.deepStrictEqual(await store.loadAll("prices"), [{ id: "a", averages: { R: 9 } }]);
  assert.deepStrictEqual(await store.get("filters"), { text: "x" });
  assert.strictEqual((await store.loadAll("cards")).length, 1);

  await legacy.putMany("prices", [{ id: "z", averages: {} }]);
  const again = createExtensionStore(area, legacy);
  assert.strictEqual((await again.loadAll("prices")).length, 1);
});
