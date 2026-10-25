const { test, after } = require("node:test");
const assert = require("node:assert");
const { IDBFactory } = require("fake-indexeddb");
const { COLLECTION, MARKET, closeAll, createPage, listing, owned, sleep, until } = require("./helpers.js");

after(closeAll);

test("marketplace toggle: off means no automatic request and a Calculer badge, on resumes the visible cards", async () => {
  const idb = new IDBFactory();
  const seeder = createPage([], { idb });
  await sleep(50);
  await seeder.w.WMT.store.set("prefs", { autoMarket: false });

  const requests = [];
  const page = createPage(requests, { html: MARKET, pathname: "/marketplace", idb });
  await sleep(100);
  const doc = page.w.document;
  page.hook("/api/marketplace", listing);
  await until(() => doc.querySelectorAll(".wmt-badge").length === 2);
  await until(() => [...doc.querySelectorAll(".wmt-badge")].every((b) => b.dataset.state === "idle"));
  await sleep(200);
  assert.strictEqual(requests.filter((r) => r.includes("/sales")).length, 0);
  assert.strictEqual(doc.querySelector(".wmt-strip input[type=checkbox]").checked, false);

  const badges = [...doc.querySelectorAll(".wmt-badge")];
  badges[0].click();
  await until(() => badges[0].dataset.state === "ready");
  assert.strictEqual(requests.filter((r) => r.includes("/sales")).length, 1);
  assert.strictEqual(badges[1].dataset.state, "idle");

  const toggle = doc.querySelector(".wmt-strip input[type=checkbox]");
  toggle.checked = true;
  toggle.dispatchEvent(new page.w.Event("change", { bubbles: true }));
  await until(() => badges[1].dataset.state === "ready");
  assert.strictEqual(requests.filter((r) => r.includes("/sales")).length, 2);
  assert.strictEqual((await page.w.WMT.store.get("prefs")).autoMarket, true);
});

test("the toggle only concerns the marketplace: the collection keeps computing prices automatically", async () => {
  const idb = new IDBFactory();
  const seeder = createPage([], { idb });
  await sleep(50);
  await seeder.w.WMT.store.set("prefs", { autoMarket: false });
  const requests = [];
  const page = createPage(requests, { html: COLLECTION, pathname: "/collection", idb });
  await sleep(100);
  page.hook("/api/my-collection", { collection: [owned("o1")] });
  await until(() => requests.some((r) => r.includes("/sales")));
  assert.strictEqual(page.w.document.querySelectorAll(".wmt-strip").length, 1);
});

test("global collection: cards come from /api/cards, auto calculation is off by default and each card has a Calculer button", async () => {
  const requests = [];
  const page = createPage(requests, { html: MARKET.replace("Marché", "Collection Globale"), pathname: "/global-collection" });
  await sleep(100);
  const doc = page.w.document;
  page.hook("/api/cards", { cards: [{ id: "c1", wikipedia_title: "Élysée", rarity: "R" }, { id: "c2", wikipedia_title: "Lyon", rarity: "C" }] });
  await until(() => [...doc.querySelectorAll(".wmt-badge")].length === 2 && [...doc.querySelectorAll(".wmt-badge")].every((b) => b.dataset.state === "idle"));
  await sleep(200);
  assert.strictEqual(requests.filter((r) => r.includes("/sales")).length, 0);
  assert.match(doc.querySelector(".wmt-strip").textContent, /collection globale/);
  assert.strictEqual(doc.querySelector(".wmt-strip input").checked, false);

  const second = doc.querySelectorAll(".wmt-badge")[1];
  second.click();
  await until(() => second.dataset.state === "ready");
  assert.deepStrictEqual(requests.filter((r) => r.includes("/sales")).length, 1);
  assert.strictEqual(doc.querySelectorAll(".wmt-badge")[0].dataset.state, "idle");

  doc.querySelector(".wmt-strip input").checked = true;
  doc.querySelector(".wmt-strip input").dispatchEvent(new page.w.Event("change", { bubbles: true }));
  await until(() => doc.querySelectorAll(".wmt-badge")[0].dataset.state === "ready");
  assert.strictEqual((await page.w.WMT.store.get("prefs")).autoGlobal, true);
});

test("the toggle strip goes under the page title in main, not next to the sidebar logo", async () => {
  const html = `<nav><a><h1>WikiMasters</h1></a></nav>${MARKET}`;
  const page = createPage([], { html, pathname: "/marketplace" });
  await sleep(100);
  page.hook("/api/marketplace", listing);
  await until(() => page.w.document.querySelector(".wmt-strip"));
  assert.strictEqual(page.w.document.querySelector("nav .wmt-strip"), null);
  assert.strictEqual(page.w.document.querySelector("main .wmt-strip") !== null, true);
});
