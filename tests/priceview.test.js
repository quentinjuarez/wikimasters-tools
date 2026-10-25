const { test, after } = require("node:test");
const assert = require("node:assert");
const { IDBFactory } = require("fake-indexeddb");
const { FILTER_UI, closeAll, createPage, seed, sleep, until, wireSiteFilters } = require("./helpers.js");

after(closeAll);

const FULL_PAGE = FILTER_UI.replace(
  '<div class="flex flex-wrap"></div>',
  `<div class="relative"><div class="flex flex-wrap justify-center gap-3" id="grid"><div class="relative isolate group"><div class="w-40 relative rounded-2xl overflow-hidden"><div>R</div><div><h3>Élysée</h3><div class="mt-auto"><div class="border-t">3 2</div></div></div></div></div></div></div>`,
);

function priceCards() {
  const cards = Array.from({ length: 60 }, (_, i) => ({
    cardId: `k${i + 1}`,
    title: `Carte ${String(i + 1).padStart(2, "0")}`,
    rarity: i % 2 === 0 ? "R" : "C",
    copies: [{ id: `o${i + 1}`, starred: i === 4 }],
    tags: i % 3 === 0 ? [{ id: "t1", name: "Test" }] : [],
  }));
  const prices = Object.fromEntries(cards.map((card, i) => [card.cardId, { averages: { [card.rarity]: (i + 1) * 10 }, fetchedAt: Date.now(), title: card.title, rarity: card.rarity }]));
  return { cards, prices };
}

const priceSortOption = (doc) => doc.querySelector('[role="option"][data-wmt-option]');

const sortTrigger = (doc) => doc.querySelector('button[aria-label="Trier la collection"]');

async function openPricePage(requests, extra = {}) {
  const idb = extra.idb ?? new IDBFactory();
  const seeder = createPage([], { idb });
  await sleep(50);
  const { cards, prices } = extra.data ?? priceCards();
  await seed(seeder.w, { cards, rarities: { R: { serverCount: 30, loaded: 30, syncedAt: 1 }, C: { serverCount: 30, loaded: 30, syncedAt: 1 } }, prices });
  const page = createPage(requests, { html: FULL_PAGE, pathname: "/collection", idb, ...extra.page });
  wireSiteFilters(page.w);
  await sleep(150);
  page.hook("/api/my-collection", { collection: [] });
  return { page, cards, prices, idb };
}

async function pickPriceSort(page) {
  const doc = page.w.document;
  sortTrigger(doc).click();
  await until(() => priceSortOption(doc));
  priceSortOption(doc).click();
}

const titles = (doc) => [...doc.querySelectorAll(".wmt-tile-title")].map((n) => n.textContent);

test("the sort menu gets a Prix option that lists the cache by decreasing price with the site's filters", async () => {
  const requests = [];
  const { page, cards } = await openPricePage(requests);
  const doc = page.w.document;
  assert.strictEqual(doc.querySelector(".wmt-pv-results").hidden, true);

  sortTrigger(doc).click();
  await until(() => priceSortOption(doc));
  const options = [...doc.querySelectorAll('[role="option"]')].map((o) => o.textContent);
  assert.deepStrictEqual(options, ["Rareté", "Nom", "Favoris", "Date d'ajout", "Prix décroissant"]);

  priceSortOption(doc).click();
  assert.strictEqual(sortTrigger(doc).textContent, "Prix décroissant");
  assert.strictEqual(sortTrigger(doc).getAttribute("aria-expanded"), "false");
  await until(() => doc.querySelector(".scroll-mt-4").classList.contains("wmt-site-hidden"));
  assert.strictEqual(doc.querySelector(".wmt-pv-results").hidden, false);
  assert.match(doc.querySelector(".wmt-pv-results").textContent.replace(/\s/g, " "), /60 cartes sur 60/);
  assert.strictEqual(titles(doc).length, 24);
  assert.deepStrictEqual(titles(doc).slice(0, 3), ["Carte 60", "Carte 59", "Carte 58"]);

  [...doc.querySelectorAll("#filters button.rounded-full")].find((b) => b.textContent === "R").click();
  await until(() => /30 cartes sur 60/.test(doc.querySelector(".wmt-pv-results").textContent.replace(/\s/g, " ")));
  assert.deepStrictEqual(titles(doc).slice(0, 2), ["Carte 59", "Carte 57"]);

  doc.querySelector('button[aria-label="Filtrer par étiquette"]').click();
  [...doc.querySelectorAll('[role="option"]')].find((o) => /Test/.test(o.textContent)).click();
  const tagged = cards.filter((card) => card.rarity === "R" && card.tags.length).length;
  await until(() => new RegExp(`${tagged} cartes sur 60`).test(doc.querySelector(".wmt-pv-results").textContent.replace(/\s/g, " ")));
  assert.match(doc.querySelector(".wmt-pv-results").textContent, /étiquette Test/);

  sortTrigger(doc).click();
  await until(() => [...doc.querySelectorAll('[role="option"]')].some((o) => o.textContent === "Nom"));
  [...doc.querySelectorAll('[role="option"]')].find((o) => o.textContent === "Nom").click();
  await until(() => doc.querySelector(".wmt-pv-results").hidden);
  assert.strictEqual(doc.querySelector(".scroll-mt-4").classList.contains("wmt-site-hidden"), false);
  assert.strictEqual(sortTrigger(doc).textContent, "Nom");
  assert.strictEqual(requests.filter((r) => r.includes("/sales")).length, 0);
});

test("price view tile: anti-bot refusal finds the site card by search, opens the modal, then restores the search", async () => {
  const { page } = await openPricePage([], {
    page: { post: () => ({ ok: false, status: 403, headers: { get: () => null }, json: async () => ({ code: "human_verification_required", error: "Vérification anti-bot requise." }) }) },
  });
  const doc = page.w.document;
  const search = doc.querySelector('input[placeholder^="Rechercher"]');
  const grid = doc.getElementById("grid");
  const original = grid.innerHTML;
  const siteCard = (title) =>
    `<div class="w-40 relative rounded-2xl overflow-hidden"><div>R</div><div><h3>${title}</h3></div></div>`;
  search.addEventListener("input", () => {
    grid.innerHTML = search.value ? siteCard("Carte 01") + siteCard("Carte 011") : original;
  });
  doc.addEventListener("click", (event) => {
    if (!event.target.closest?.("#grid .rounded-2xl")) return;
    const open = doc.createElement("button");
    open.textContent = "Mettre aux enchères";
    open.addEventListener("click", () => {
      const modal = doc.createElement("div");
      modal.id = "modal";
      modal.innerHTML = '<input type="number" value="10"><button>10 min</button><button id="go">Lancer l\'enchère</button>';
      doc.body.append(modal);
    });
    doc.body.append(open);
  });

  await pickPriceSort(page);
  await until(() => doc.querySelector(".wmt-tile .wmt-sell"));
  const tile = doc.querySelector(".wmt-tile");
  const target = tile.querySelector(".wmt-tile-title").textContent;
  search.addEventListener("input", () => {
    if (search.value) grid.innerHTML = siteCard("Autre") + siteCard(target);
  });
  const button = tile.querySelector(".wmt-sell");
  button.click();
  await until(() => doc.getElementById("go") && button.dataset.state === "busy");
  assert.strictEqual(search.value, target);
  assert.strictEqual(doc.querySelector("#modal input").value, "10");
  doc.getElementById("go").click();
  doc.getElementById("modal").remove();
  await until(() => search.value === "");
  await until(() => button.dataset.state === "done");
});

test("the price view does not rebuild its tiles while nothing changed, so hover, selection and clicks survive", async () => {
  const { page } = await openPricePage([]);
  const doc = page.w.document;
  await pickPriceSort(page);
  await until(() => doc.querySelectorAll(".wmt-tile").length === 24);
  await sleep(400);
  const first = doc.querySelector(".wmt-tile");
  let mutations = 0;
  new page.w.MutationObserver((records) => (mutations += records.length)).observe(doc.body, { childList: true, subtree: true, characterData: true });
  doc.body.appendChild(doc.createElement("span"));
  await sleep(1200);
  assert.strictEqual(doc.querySelector(".wmt-tile"), first);
  assert.ok(mutations <= 2, `unexpected DOM churn: ${mutations}`);
});

test("the price sort is remembered with the other filters and comes back on the next visit", async () => {
  const { page, idb } = await openPricePage([]);
  const doc = page.w.document;
  await pickPriceSort(page);
  await sleep(700);
  assert.strictEqual((await page.w.WMT.store.get("filters")).sort, "Prix décroissant");

  const next = createPage([], { html: FULL_PAGE, pathname: "/collection", idb });
  wireSiteFilters(next.w);
  await sleep(100);
  next.hook("/api/my-collection", { collection: [] });
  await until(() => sortTrigger(next.w.document).textContent === "Prix décroissant" && next.w.document.querySelector(".wmt-pv-results").hidden === false, 8000);
  assert.strictEqual(next.w.document.querySelectorAll(".wmt-tile").length, 24);
  assert.ok(doc);
});

test("cards without a price come last with a Calculer button that adds them to the queue", async () => {
  const data = priceCards();
  delete data.prices.k60;
  const requests = [];
  const { page } = await openPricePage(requests, { data });
  const doc = page.w.document;
  await pickPriceSort(page);
  await until(() => doc.querySelector(".wmt-tile"));
  assert.match(doc.querySelector(".wmt-pv-results").textContent, /1 sans prix/);

  assert.strictEqual([...doc.querySelectorAll(".wmt-tile")].some((tile) => tile.textContent.includes("Carte 60")), false);

  const next = [...doc.querySelectorAll(".wmt-pager .wmt-btn")].find((b) => b.textContent === "Suivant");
  next.click();
  next.click();
  const tile = [...doc.querySelectorAll(".wmt-tile")].find((node) => node.textContent.includes("Carte 60"));
  assert.ok(tile);
  tile.querySelector(".wmt-btn").click();
  await until(() => requests.some((r) => r.includes("/k60") || r.includes("/sales")));
});

test("selling from a price view tile lists the card and removes it from the cache", async () => {
  const cards = [{ cardId: "c1", title: "Élysée", rarity: "R", copies: [{ id: "o1", starred: false }], tags: [] }];
  const prices = { c1: { averages: { R: 500 }, fetchedAt: Date.now(), title: "Élysée", rarity: "R" } };
  const posts = [];
  const { page } = await openPricePage([], { data: { cards, prices }, page: { post: (body, ok) => (posts.push(body), ok({})) } });
  const doc = page.w.document;
  await pickPriceSort(page);
  await until(() => doc.querySelector(".wmt-tile .wmt-sell"));
  doc.querySelector(".wmt-tile .wmt-sell").click();
  await until(() => posts.length === 1);
  assert.deepStrictEqual(posts[0], { card_id: "o1", base_amount: 10, duration_minutes: 10 });
  await until(() => doc.querySelectorAll(".wmt-tile").length === 0, 3000);
  assert.strictEqual((await page.w.WMT.store.loadAll("cards")).length, 0);
});
