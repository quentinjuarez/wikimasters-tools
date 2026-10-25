(function (root) {
  const DB_NAME = "wmt";
  const DB_VERSION = 2;
  const RETRY_DELAY_MS = 300;
  const READ_ATTEMPTS = 4;
  const TABLES = { prices: "id", cards: "cardId" };

  function createMemoryStore(initial = {}) {
    const kv = new Map(Object.entries(initial.kv ?? {}));
    const tables = Object.fromEntries(
      Object.entries(TABLES).map(([name, keyPath]) => [name, new Map((initial[name] ?? []).map((record) => [record[keyPath], record]))]),
    );
    return {
      get: async (key) => kv.get(key),
      set: async (key, value) => void kv.set(key, value),
      del: async (key) => void kv.delete(key),
      loadAll: async (name) => [...tables[name].values()],
      putMany: async (name, records) => {
        for (const record of records) tables[name].set(record[TABLES[name]], record);
      },
      deleteMany: async (name, keys) => {
        for (const key of keys) tables[name].delete(key);
      },
    };
  }

  function createIdbStore(idb) {
    const memory = createMemoryStore();
    let dbPromise = null;

    function open() {
      dbPromise ??= new Promise((resolve, reject) => {
        const request = idb.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
          for (const [name, keyPath] of Object.entries(TABLES)) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
          }
        };
        request.onsuccess = () => {
          request.result.onversionchange = () => {
            request.result.close();
            dbPromise = null;
          };
          resolve(request.result);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () => reject(new Error("IndexedDB bloquée"));
      }).catch((error) => {
        dbPromise = null;
        throw error;
      });
      return dbPromise;
    }

    async function transact(name, mode, work) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(name, mode);
        const request = work(tx.objectStore(name));
        tx.oncomplete = () => resolve(request?.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error("transaction annulée"));
      });
    }

    const guarded = (idbWork, fallback, attempts = 1) => async (...args) => {
      for (let attempt = 1; ; attempt += 1) {
        try {
          return await idbWork(...args);
        } catch {
          if (attempt >= attempts) return fallback(...args);
          dbPromise = null;
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
        }
      }
    };

    async function dump() {
      const keys = await transact("kv", "readonly", (store) => store.getAllKeys());
      const values = await transact("kv", "readonly", (store) => store.getAll());
      const result = { kv: Object.fromEntries(keys.map((key, index) => [key, values[index]])) };
      for (const name of Object.keys(TABLES)) result[name] = await transact(name, "readonly", (store) => store.getAll());
      return result;
    }

    return {
      dump,
      get: async (key) => {
        const recent = await memory.get(key);
        if (recent !== undefined) return recent;
        return guarded((name) => transact("kv", "readonly", (store) => store.get(name)), memory.get, READ_ATTEMPTS)(key);
      },
      set: async (key, value) => {
        await memory.set(key, value);
        try {
          await transact("kv", "readwrite", (store) => store.put(value, key));
        } catch {
          return;
        }
      },
      del: guarded((key) => transact("kv", "readwrite", (store) => store.delete(key)), memory.del),
      loadAll: guarded((name) => transact(name, "readonly", (store) => store.getAll()), memory.loadAll, READ_ATTEMPTS),
      putMany: async (name, records) => {
        if (!records.length) return;
        try {
          await transact(name, "readwrite", (store) => {
            for (const record of records) store.put(record);
          });
        } catch {
          await memory.putMany(name, records);
        }
      },
      deleteMany: async (name, keys) => {
        if (!keys.length) return;
        try {
          await transact(name, "readwrite", (store) => {
            for (const key of keys) store.delete(key);
          });
        } catch {
          await memory.deleteMany(name, keys);
        }
      },
    };
  }

  function createExtensionStore(area, legacy) {
    const IMPORTED = "meta:imported";
    let snapshot = null;

    async function importLegacy(entries) {
      const dump = await legacy.dump();
      const copy = {};
      for (const [key, value] of Object.entries(dump.kv)) copy[`kv:${key}`] = value;
      for (const [name, keyPath] of Object.entries(TABLES)) {
        for (const record of dump[name]) copy[`${name}:${record[keyPath]}`] = record;
      }
      copy[IMPORTED] = true;
      await area.set(copy);
      return { ...entries, ...copy };
    }

    const load = () =>
      (snapshot ??= area.get(null).then(async (entries) => {
        let all = entries;
        if (legacy && !all[IMPORTED]) {
          try {
            all = await importLegacy(all);
          } catch {
            all = entries;
          }
        }
        return new Map(Object.entries(all));
      }));

    const write = async (changes) => {
      const map = await load();
      await area.set(changes);
      for (const [key, value] of Object.entries(changes)) map.set(key, value);
    };

    const remove = async (keys) => {
      const map = await load();
      await area.remove(keys);
      for (const key of keys) map.delete(key);
    };

    return {
      get: async (key) => (await load()).get(`kv:${key}`),
      set: (key, value) => write({ [`kv:${key}`]: value }),
      del: (key) => remove([`kv:${key}`]),
      loadAll: async (name) => [...(await load())].filter(([key]) => key.startsWith(`${name}:`)).map(([, record]) => record),
      putMany: (name, records) =>
        records.length ? write(Object.fromEntries(records.map((record) => [`${name}:${record[TABLES[name]]}`, record]))) : undefined,
      deleteMany: (name, keys) => (keys.length ? remove(keys.map((key) => `${name}:${key}`)) : undefined),
    };
  }

  async function migrate(store) {
    const legacyPrices = await store.get("prices");
    if (legacyPrices && typeof legacyPrices === "object") {
      await store.putMany("prices", Object.entries(legacyPrices).map(([id, entry]) => ({ id, ...entry })));
      await store.del("prices");
    }
    const legacyCollection = await store.get("collection");
    if (legacyCollection && typeof legacyCollection === "object") {
      const { cards = [], ...meta } = legacyCollection;
      await store.putMany("cards", cards);
      await store.set("collection-meta", meta);
      await store.del("collection");
    }
  }

  const api = { createMemoryStore, createIdbStore, createExtensionStore, migrate, TABLES };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    const wmt = (root.WMT = root.WMT || {});
    const area = root.chrome?.storage?.local;
    wmt.store = area ? createExtensionStore(area, createIdbStore(indexedDB)) : createIdbStore(indexedDB);
    wmt.store.migrate = () => migrate(wmt.store);
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
