const { test, after } = require("node:test");
const assert = require("node:assert");
const { IDBFactory } = require("fake-indexeddb");
const { closeAll, createPage, listing, sleep, until } = require("./helpers.js");

after(closeAll);

const AUCTION_ID = "a230cabf-919a-4a9e-a258-e9d50592982c";

const DETAIL = `
  <main><div><h1 class="flex-1">Élysée</h1>
    <div class="w-72 relative rounded-2xl overflow-hidden"><div class="absolute top-2 left-2">R</div><div><h3>Élysée</h3><div class="mt-auto"><div class="border-t">2826 1358</div></div></div></div>
  </div></main>`;

test("badges show up on cards from the hooked payload and survive a reload without any price call", async () => {
  const first = [];
  const idb = new IDBFactory();
  const page1 = createPage(first, { idb });
  await sleep(50);
  page1.hook("/api/marketplace", listing);
  await until(() => page1.text(".wmt-badge").join("|") === "1 200 W|7 W");
  assert.deepStrictEqual(first.filter((r) => r.endsWith("scope=summary")).length, 2);
  await sleep(1700);

  const second = [];
  const page2 = createPage(second, { idb });
  await sleep(50);
  page2.hook("/api/marketplace", listing);
  await until(() => page2.text(".wmt-badge").join("|") === "1 200 W|7 W");
  assert.deepStrictEqual(second.filter((r) => r.includes("/sales")), []);
  await until(() => /2 prix en cache/.test(page2.text(".wmt-bar").join("")));
});

test("the shared queue lists badge requests too, and an unavailable price is retried by clicking its badge", async () => {
  let attempts = 0;
  const requests = [];
  const page = createPage(requests, {
    sales: (id, ok) => (id === "c1" && ++attempts === 1 ? { ok: false, status: 404, headers: { get: () => null }, json: async () => ({ error: "x" }) } : null),
  });
  await sleep(50);
  const doc = page.w.document;
  page.hook("/api/marketplace", listing);
  await until(() => [...doc.querySelectorAll(".wmt-badge")].some((b) => b.dataset.state === "failed"));
  const failed = [...doc.querySelectorAll(".wmt-badge")].find((b) => b.dataset.state === "failed");
  assert.strictEqual(failed.textContent, "Réessayer");
  failed.click();
  await until(() => failed.dataset.state === "ready");
  assert.strictEqual(failed.textContent.replace(/\s/g, " "), "1 200 W");
  assert.strictEqual(attempts, 2);
});

test("a known price is never recomputed on its own, only when its badge is clicked", async () => {
  const requests = [];
  const idb = new IDBFactory();
  const seeder = createPage([], { idb });
  await sleep(50);
  await seeder.w.WMT.store.putMany("prices", [{ id: "c1", averages: { R: 7 }, fetchedAt: Date.now() - 10 * 86400000, title: "Élysée", rarity: "R" }]);
  const page = createPage(requests, { idb });
  await sleep(100);
  const doc = page.w.document;
  page.hook("/api/marketplace", listing);
  await until(() => [...doc.querySelectorAll(".wmt-badge")].some((b) => b.dataset.state === "ready"));
  await sleep(300);
  const badge = [...doc.querySelectorAll(".wmt-badge")].find((b) => b.dataset.state === "ready");
  assert.match(badge.title, /il y a 10 j/);
  assert.strictEqual(requests.filter((r) => r.includes("/c1/")).length, 0);
  badge.click();
  await until(() => requests.some((r) => r.includes("/c1/")));
});

test("an auction page computes the price of an uncached card by itself, even when the market toggle is off", async () => {
  const idb = new IDBFactory();
  const seeder = createPage([], { idb });
  await sleep(50);
  await seeder.w.WMT.store.set("prefs", { autoMarket: false, autoGlobal: false, rememberFilters: true });

  const requests = [];
  const page = createPage(requests, { html: DETAIL, pathname: `/marketplace/${AUCTION_ID}`, idb });
  await sleep(100);
  const doc = page.w.document;
  page.hook(`/api/marketplace/${AUCTION_ID}`, { auction: { id: AUCTION_ID, card_id: "c1", snapshot_rarity: "R", card: { id: "c1", wikipedia_title: "Élysée", rarity: "R" } } });
  await until(() => doc.querySelector(".wmt-badge")?.dataset.state === "ready");
  assert.strictEqual(doc.querySelector(".wmt-badge").textContent.replace(/\s/g, " "), "1 200 W");
  assert.strictEqual(requests.filter((r) => r.includes("/sales")).length, 1);
  assert.strictEqual(doc.querySelector(".wmt-strip"), null);
  await page.w.WMT.prices.flush();

  const again = createPage([], { html: DETAIL, pathname: `/marketplace/${AUCTION_ID}`, idb });
  await sleep(100);
  const requests2 = [];
  again.w.fetch = async () => {
    requests2.push("called");
    throw new Error("no network expected");
  };
  again.hook(`/api/marketplace/${AUCTION_ID}`, { auction: { id: AUCTION_ID, card_id: "c1", snapshot_rarity: "R", card: { id: "c1", wikipedia_title: "Élysée", rarity: "R" } } });
  await until(() => again.w.document.querySelector(".wmt-badge")?.dataset.state === "ready");
  assert.strictEqual(requests2.length, 0);
});
