const { test, after } = require("node:test");
const assert = require("node:assert");
const { IDBFactory } = require("fake-indexeddb");
const { MARKET, closeAll, createPage, listing, seed, sleep, until } = require("./helpers.js");

after(closeAll);

test("the estimation panel does collection and prices in one action, with a shared queue", async () => {
  const requests = [];
  const page = createPage(requests);
  await sleep(50);
  const doc = page.w.document;
  doc.querySelector(".wmt-bar").click();
  await until(() => requests.includes("/api/my-collection?sort=rarity&page=0&stats=1"));
  const run = () => [...doc.querySelectorAll(".wmt-panel .wmt-btn")].find((b) => /estimer ma sélection/i.test(b.textContent));
  await until(() => run() && !run().disabled);
  assert.match(doc.querySelector(".wmt-panel").textContent, /charger 1 page de ta collection/);

  run().click();
  await until(() => /3 prix calculés/.test(doc.querySelector(".wmt-panel").textContent), 15000);
  assert.strictEqual(requests.filter((r) => r.startsWith("/api/my-collection")).length, 1);
  assert.strictEqual(requests.filter((r) => r.includes("/sales")).length, 3);
  await until(() => doc.querySelector(".wmt-queue").hidden);
  assert.match(doc.querySelector(".wmt-hero-value").textContent.replace(/\s/g, " "), /^\d[\d ]* W$/);
});

test("the panel shows the estimated value of the selection from the cache without any request", async () => {
  const idb = new IDBFactory();
  const seeder = createPage([], { idb });
  await sleep(50);
  const cards = Array.from({ length: 45 }, (_, i) => ({
    cardId: `k${i + 1}`,
    title: `Carte ${String(i + 1).padStart(2, "0")}`,
    rarity: "R",
    copies: [{ id: `o${i + 1}`, starred: false }],
    tags: [],
  }));
  const prices = Object.fromEntries(
    cards.slice(0, 40).map((card, i) => [card.cardId, { averages: { R: (i + 1) * 10 }, fetchedAt: Date.now(), title: card.title, rarity: "R" }]),
  );
  await seed(seeder.w, { cards, rarities: { R: { serverCount: 45, loaded: 45, syncedAt: 1 } }, prices: prices });

  const requests = [];
  const page = createPage(requests, { idb });
  await sleep(100);
  const doc = page.w.document;
  doc.querySelector(".wmt-bar").click();
  await until(() => /8 200 W/.test(doc.querySelector(".wmt-hero-value").textContent.replace(/\s/g, " ")));
  assert.match(doc.querySelector(".wmt-hero-sub").textContent, /45 cartes sélectionnées, dont 5 sans prix/);
  assert.strictEqual(doc.querySelectorAll(".wmt-spread-part").length, 1);
  assert.strictEqual(requests.filter((r) => r.includes("/sales")).length, 0);
});

test("the panel leads with the estimate, hides the queue when idle and keeps the speed slider in the settings", async () => {
  const idb = new IDBFactory();
  const page = createPage([], { idb });
  await sleep(100);
  const doc = page.w.document;
  doc.querySelector(".wmt-bar").click();
  assert.strictEqual(doc.querySelector(".wmt-panel").firstElementChild.tagName, "DIV");
  assert.ok(doc.querySelector(".wmt-hero"));
  assert.strictEqual(doc.querySelector(".wmt-queue").hidden, true);
  assert.strictEqual(doc.querySelector(".wmt-details").open, false);
  assert.strictEqual(doc.querySelectorAll(".wmt-list, .wmt-history, .wmt-toggle").length, 0);

  const range = doc.querySelector('input[aria-label="Délai minimum entre deux requêtes"]');
  assert.strictEqual(range.disabled, true);
  assert.match(doc.querySelector(".wmt-speed").textContent, /Rythme automatique/);
  const auto = doc.querySelector(".wmt-speed input[type=checkbox]");
  auto.checked = false;
  auto.dispatchEvent(new page.w.Event("change", { bubbles: true }));
  range.value = "2500";
  range.dispatchEvent(new page.w.Event("input", { bubbles: true }));
  assert.strictEqual(range.disabled, false);
  assert.match(doc.querySelector(".wmt-speed").textContent, /2,5 s minimum/);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await page.w.WMT.store.get("rate-setting"))), { manual: 2500 });
  assert.strictEqual(page.w.WMT.prices.status().gapMs, 2500);

  auto.checked = true;
  auto.dispatchEvent(new page.w.Event("change", { bubbles: true }));
  assert.strictEqual(page.w.WMT.prices.status().manualGapMs, null);
});

test("the panel offers to skip the site's pause, and a manual Calculer click is served first", async () => {
  let hits = 0;
  const requests = [];
  const page = createPage(requests, {
    html: MARKET,
    pathname: "/marketplace",
    sales: (id, ok) => {
      hits += 1;
      return hits === 1 ? { ok: false, status: 429, headers: { get: (name) => (name === "Retry-After" ? "60" : null) }, json: async () => ({ error: "slow" }) } : null;
    },
  });
  await sleep(100);
  const doc = page.w.document;
  page.hook("/api/marketplace", listing);
  await until(() => requests.some((r) => r.includes("/sales")));
  doc.querySelector(".wmt-bar").click();
  const resume = () => [...doc.querySelectorAll(".wmt-panel .wmt-btn")].find((b) => b.textContent === "Reprendre");
  await until(() => resume() && !resume().hidden);
  assert.match(doc.querySelector(".wmt-panel").textContent, /demande une pause/);

  resume().click();
  await until(() => [...doc.querySelectorAll(".wmt-badge")].every((b) => b.dataset.state === "ready"), 8000);
  assert.strictEqual(resume().hidden, true);
});
