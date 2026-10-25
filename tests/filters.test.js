const { test, after } = require("node:test");
const assert = require("node:assert");
const { IDBFactory } = require("fake-indexeddb");
const { FILTER_UI, closeAll, createPage, sleep, until, wireSiteFilters } = require("./helpers.js");

after(closeAll);

const filterState = (doc) => ({
  text: doc.querySelector("#filters input").value,
  tag: doc.querySelector('button[aria-label="Filtrer par étiquette"]').textContent,
  sort: doc.querySelector('button[aria-label="Trier la collection"]').textContent,
  on: [...doc.querySelectorAll("#filters button.rounded-full")].filter((b) => !b.classList.contains("opacity-50")).map((b) => b.textContent),
});

test("collection filters are saved when they change and re-applied through the site's own UI on the next visit", async () => {
  const idb = new IDBFactory();
  const first = createPage([], { html: FILTER_UI, pathname: "/collection", idb });
  await sleep(100);
  wireSiteFilters(first.w);
  const doc = first.w.document;
  first.hook("/api/my-collection", { collection: [] });
  await sleep(200);

  const chips = [...doc.querySelectorAll("#filters button.rounded-full")];
  chips.find((b) => b.textContent === "R").click();
  chips.find((b) => b.textContent === "C").click();
  const input = doc.querySelector("#filters input");
  input.value = "abc";
  input.dispatchEvent(new first.w.Event("input", { bubbles: true }));
  doc.querySelector('button[aria-label="Filtrer par étiquette"]').click();
  [...doc.querySelectorAll('[role="option"]')].find((o) => /Test/.test(o.textContent)).click();
  doc.querySelector('button[aria-label="Trier la collection"]').click();
  [...doc.querySelectorAll('[role="option"]')].find((o) => o.textContent === "Nom").click();

  await sleep(600);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await first.w.WMT.store.get("filters"))), { text: "abc", tag: "Test", sort: "Nom", rarities: ["R", "C"] });

  const second = createPage([], { html: FILTER_UI, pathname: "/collection", idb });
  wireSiteFilters(second.w);
  await sleep(100);
  second.hook("/api/my-collection", { collection: [] });
  await until(() => {
    const state = filterState(second.w.document);
    return state.text === "abc" && state.tag === "#Test (1)" && state.sort === "Nom" && state.on.join() === "R,C";
  }, 8000);
  assert.strictEqual(second.w.document.querySelectorAll('[role="option"]').length, 0);
});

test("remembering can be switched off from the collection bar, and a missing tag is skipped without erasing the rest", async () => {
  const idb = new IDBFactory();
  const seeder = createPage([], { idb });
  await sleep(50);
  await seeder.w.WMT.store.set("filters", { text: "zz", tag: "Disparue", sort: "Favoris", rarities: ["L"] });

  const page = createPage([], { html: FILTER_UI, pathname: "/collection", idb });
  wireSiteFilters(page.w);
  await sleep(100);
  page.hook("/api/my-collection", { collection: [] });
  await until(() => {
    const state = filterState(page.w.document);
    return state.text === "zz" && state.sort === "Favoris" && state.on.join() === "L";
  }, 10000);
  assert.strictEqual(filterState(page.w.document).tag, "Toutes les étiquettes");
  assert.strictEqual(page.w.document.querySelectorAll('[role="option"]').length, 0);

  const offIdb = new IDBFactory();
  const seed2 = createPage([], { idb: offIdb });
  await sleep(50);
  await seed2.w.WMT.store.set("filters", { text: "zz", tag: null, sort: "Rareté", rarities: ["L"] });
  await seed2.w.WMT.store.set("prefs", { autoMarket: true, autoGlobal: false, rememberFilters: false });
  const off = createPage([], { html: FILTER_UI, pathname: "/collection", idb: offIdb });
  wireSiteFilters(off.w);
  await sleep(100);
  off.hook("/api/my-collection", { collection: [] });
  await sleep(1200);
  assert.strictEqual(filterState(off.w.document).text, "");
  assert.deepStrictEqual(filterState(off.w.document).on, []);
});
