const { test } = require("node:test");
const assert = require("node:assert");
const L = require("../src/logic.js");

const entry = (id, cardId, title, rarity, extra = {}) => ({ id, card_id: cardId, card: { wikipedia_title: title, rarity }, ...extra });
const tag = (id, name) => ({ tag: { id, name } });

const cards = L.mergeCollection(
  [
    entry("o1", "c1", "Rue de Rivoli", "R", { tags: [tag("t1", "Paris")] }),
    entry("o2", "c2", "Élysée", "SR", { tags: [tag("t1", "Paris"), tag("t2", "Palais")] }),
    entry("o3", "c3", "Berlin", "L"),
    entry("o4", "c1", "Rue de Rivoli", "R"),
    entry("o5", "c4", "Lyon", "C"),
    { id: "bad", card: {} },
  ]
    .map(L.mapEntry)
    .filter(Boolean),
);

const prices = {
  c1: { averages: { R: 50 }, fetchedAt: Date.now() },
  c2: { averages: { SR: 300, R: 5 }, fetchedAt: Date.now() - 2 * 86400000 },
  c3: { averages: { L: 900 }, fetchedAt: Date.now() },
  c4: { averages: {}, fetchedAt: Date.now() },
};

test("merges copies of a card and drops invalid entries", () => {
  assert.strictEqual(cards.length, 4);
  assert.deepStrictEqual(cards.find((c) => c.cardId === "c1").copies.map((c) => c.id), ["o1", "o4"]);
});

test("price uses the average of the card's own rarity only", () => {
  assert.strictEqual(L.priceFor(cards.find((c) => c.cardId === "c2"), prices), 300);
  assert.strictEqual(L.priceFor(cards.find((c) => c.cardId === "c4"), prices), null);
  assert.strictEqual(L.priceFor({ cardId: "zz", rarity: "R" }, prices), null);
});

test("filters by rarity, tags and accent-insensitive words, sorted by rarity", () => {
  const ids = (criteria) => L.filterCards(cards, criteria).map((c) => c.cardId);
  assert.deepStrictEqual(ids({}), ["c3", "c2", "c1", "c4"]);
  assert.deepStrictEqual(ids({ rarities: ["L", "C"] }), ["c3", "c4"]);
  assert.deepStrictEqual(ids({ includeTags: ["t1"] }), ["c2", "c1"]);
  assert.deepStrictEqual(ids({ includeTags: ["t1"], excludeTags: ["t2"] }), ["c1"]);
  assert.deepStrictEqual(ids({ text: "elysee palais" }), ["c2"]);
  assert.deepStrictEqual(ids({ text: "  RUE   rivoli " }), ["c1"]);
});

test("price stats and load selection keep old prices unless asked, rare first", () => {
  const now = Date.now();
  const partial = { c1: prices.c1, c2: prices.c2 };
  assert.deepStrictEqual(L.selectForLoad(cards, partial).map((c) => c.cardId), ["c3", "c4"]);
});

test("rarity page ranges follow the L to C order and cover only requested rarities", () => {
  const counts = { L: 3, UR: 0, SR: 60, R: 40, PC: 0, C: 200 };
  assert.deepStrictEqual(L.rarityPages(counts, ["L"]), [0]);
  assert.deepStrictEqual(L.rarityPages(counts, ["SR"]), [0, 1]);
  assert.deepStrictEqual(L.rarityPages(counts, ["L", "SR", "R"]), [0, 1, 2]);
  assert.deepStrictEqual(L.rarityPages(counts, ["C"]), [2, 3, 4, 5, 6]);
  assert.deepStrictEqual(L.rarityPages(counts, ["UR", "PC"]), []);
});

test("rarity sync replaces only synced rarities and records the server count", () => {
  const mapped = [
    { ownedId: "n1", cardId: "x1", title: "X1", rarity: "R", starred: false, tags: [] },
    { ownedId: "n1", cardId: "x1", title: "X1", rarity: "R", starred: false, tags: [] },
    { ownedId: "n2", cardId: "x2", title: "X2", rarity: "C", starred: false, tags: [] },
  ];
  const base = { ...L.emptyCache(), cards: cards.map((c) => ({ ...c })) };
  const next = L.applyRaritySync(base, mapped, ["R"], { R: 1 }, 123);
  assert.deepStrictEqual(next.cards.filter((c) => c.rarity === "R").map((c) => c.cardId), ["x1"]);
  assert.ok(next.cards.some((c) => c.cardId === "c3"));
  assert.ok(!next.cards.some((c) => c.cardId === "x2"));
  assert.deepStrictEqual(next.rarities.R, { serverCount: 1, loaded: 1, syncedAt: 123 });
  assert.strictEqual(L.rarityStatus(next, { R: 1 }, "R"), "ok");
  assert.strictEqual(L.rarityStatus(next, { R: 2 }, "R"), "changed");
  assert.strictEqual(L.rarityStatus(next, { L: 4 }, "L"), "missing");
  assert.strictEqual(L.rarityStatus(next, {}, "L"), "ok");
});

test("tag sync adds membership, drops stale membership and keeps other tags", () => {
  const base = { ...L.emptyCache(), cards: cards.map((c) => ({ ...c, copies: c.copies.map((x) => ({ ...x })) })) };
  const mapped = [
    { ownedId: "o5", cardId: "c4", title: "Lyon", rarity: "C", starred: true, tags: [{ id: "t1", name: "Paris" }] },
    { ownedId: "o9", cardId: "c9", title: "Nouvelle", rarity: "R", starred: false, tags: [{ id: "t1", name: "Paris" }] },
  ];
  const next = L.applyTagSync(base, mapped, { id: "t1", name: "Paris", cardCount: 2 }, 5);
  const keysOf = (id) => next.cards.find((c) => c.cardId === id).tags.map((t) => t.id);
  assert.ok(keysOf("c4").includes("t1"));
  assert.ok(keysOf("c9").includes("t1"));
  assert.ok(!keysOf("c1").includes("t1"));
  assert.ok(keysOf("c2").includes("t2"));
  assert.strictEqual(next.cards.find((c) => c.cardId === "c4").copies[0].starred, true);
  assert.strictEqual(L.tagStatus(next, { id: "t1", cardCount: 2 }), "ok");
  assert.strictEqual(L.tagStatus(next, { id: "t1", cardCount: 3 }), "changed");
  assert.strictEqual(L.tagStatus(next, { id: "t9", cardCount: 1 }), "missing");
});

test("tag options keep ids and counts and ignore nameless entries", () => {
  assert.deepStrictEqual(L.mapTagOptions([{ id: 1, name: " A ", cardCount: "4" }, { id: 2 }, { name: "x" }]), [{ id: "1", name: "A", cardCount: 4 }]);
});

test("summary parsing keeps valid rarity averages only", () => {
  assert.deepStrictEqual(L.parseSummary({ summary: { L: { average: 4352 }, R: { average: "12" }, C: { average: null }, X: { average: 1 }, SR: { average: -1 } } }), { L: 4352, R: 12 });
  assert.deepStrictEqual(L.parseSummary({ summary: {} }), {});
  assert.strictEqual(L.parseSummary({ summary: [] }), null);
  assert.strictEqual(L.parseSummary(null), null);
});

test("Retry-After accepts seconds and dates, and absent values stay unknown", () => {
  assert.strictEqual(L.parseRetryAfter(null), null);
  assert.strictEqual(L.parseRetryAfter(""), null);
  assert.strictEqual(L.parseRetryAfter("5"), 5000);
  assert.strictEqual(L.parseRetryAfter(new Date(1000 + 90000).toUTCString(), 1000), 90000);
  assert.strictEqual(L.parseRetryAfter(new Date(0).toUTCString(), 1000), 0);
  assert.strictEqual(L.parseRetryAfter("soon"), null);
});

test("rate limit headers are read in the common conventions", () => {
  const from = (headers) => L.rateInfo((name) => headers[name] ?? null, 1_700_000_000_000);
  assert.deepStrictEqual(from({}), { limit: null, remaining: null, resetMs: null, retryAfterMs: null });
  assert.deepStrictEqual(from({ "x-ratelimit-limit": "60", "x-ratelimit-remaining": "7", "x-ratelimit-reset": "12" }), { limit: 60, remaining: 7, resetMs: 12000, retryAfterMs: null });
  assert.deepStrictEqual(from({ "ratelimit-remaining": "0", "ratelimit-reset": "1700000030", "retry-after": "30" }), { limit: null, remaining: 0, resetMs: 30000, retryAfterMs: 30000 });
  assert.deepStrictEqual(from({ ratelimit: "limit=100, remaining=40, reset=20" }), { limit: 100, remaining: 40, resetMs: 20000, retryAfterMs: null });
});

test("rate limit detection: 429 and the automation block only", () => {
  assert.deepStrictEqual(L.rateLimited(429, "", 5000), { retryAfterMs: 5000 });
  assert.deepStrictEqual(L.rateLimited(429, "", null), { retryAfterMs: null });
  assert.deepStrictEqual(L.rateLimited(403, "Trop de requêtes automatisées", null), { retryAfterMs: 30000 });
  assert.strictEqual(L.rateLimited(403, "Forbidden", null), null);
  assert.strictEqual(L.rateLimited(500, "x", null), null);
});

test("hooked paths are collection, marketplace (list, detail and one sub-page), packs and trades only", () => {
  const ok = ["/api/my-collection", "/api/cards", "/api/marketplace", "/api/marketplace/47cc7446-71bd-45be-8839-9ee5f152be55", "/api/marketplace/mine", "/api/packs/open", "/api/trades"];
  const no = ["/api/marketplace/cards/x/sales", "/api/my-collection/stats", "/api/friends"];
  assert.ok(ok.every((p) => L.HOOKED_PATH.test(p)));
  assert.ok(no.every((p) => !L.HOOKED_PATH.test(p)));
});

test("cards are extracted from every hooked payload shape", () => {
  const card = (id, title, rarity) => ({ id, wikipedia_title: title, rarity });
  assert.deepStrictEqual(L.cardsFromPayload("/api/my-collection", { collection: [entry("o", "c1", "A", "R"), entry("p", "c1", "A", "R")] }), [{ id: "c1", title: "A", rarity: "R" }]);
  assert.deepStrictEqual(L.cardsFromPayload("/api/marketplace", { auctions: [{ card_id: "c2", snapshot_rarity: "SR", card: card("c2", "B", "R") }] }), [{ id: "c2", title: "B", rarity: "SR" }]);
  assert.deepStrictEqual(L.cardsFromPayload("/api/marketplace/abc", { auction: { card_id: "c3", card: card("c3", "C", "UR") } }), [{ id: "c3", title: "C", rarity: "UR" }]);
  assert.deepStrictEqual(L.cardsFromPayload("/api/packs/open", { cards: [card("c4", "D", "C")] }), [{ id: "c4", title: "D", rarity: "C" }]);
  assert.deepStrictEqual(L.cardsFromPayload("/api/trades", { trades: [{ items: [{ card_id: "c5", snapshot_rarity: "L", card: card("c5", "E", "R") }] }] }), [{ id: "c5", title: "E", rarity: "L" }]);
  assert.deepStrictEqual(L.cardsFromPayload("/api/cards", { cards: [card("c6", "F", "SR"), { id: "x" }] }), [{ id: "c6", title: "F", rarity: "SR" }]);
  assert.deepStrictEqual(L.cardsFromPayload("/api/trades", null), []);
});

test("the page hook watches exactly the paths the extension understands", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "hook.js"), "utf8");
  assert.ok(source.includes(L.HOOKED_PATH.source));
});

test("owned copies come from the collection payload only, starred copies are picked last", () => {
  const json = { collection: [entry("o1", "c1", "A", "R", { starred: true }), entry("o2", "c1", "A", "R"), { card_id: "c9" }] };
  assert.deepStrictEqual(L.ownedFromPayload("/api/my-collection", json), [
    { cardId: "c1", ownedId: "o1", starred: true },
    { cardId: "c1", ownedId: "o2", starred: false },
  ]);
  assert.deepStrictEqual(L.ownedFromPayload("/api/marketplace", json), []);
  assert.strictEqual(L.pickCopy([{ id: "a", starred: true }, { id: "b", starred: false }]).id, "b");
  assert.strictEqual(L.pickCopy([]), null);
});

test("sale settings fall back to 10 W and 10 min when invalid", () => {
  assert.deepStrictEqual(L.normalizeSale(null), { amount: 10, duration: 10, visible: true });
  assert.deepStrictEqual(L.normalizeSale({ amount: "25", duration: 60 }), { amount: 25, duration: 60, visible: true });
  assert.deepStrictEqual(L.normalizeSale({ amount: 0, duration: 7 }), { amount: 10, duration: 10, visible: true });
  assert.deepStrictEqual(L.normalizeSale({ amount: 1.5, duration: 720, visible: false }), { amount: 10, duration: 720, visible: false });
  assert.ok(L.OWNERSHIP_ERROR.test("Vous ne possédez pas cette carte"));
});

test("price bounds keep only priced cards in range, sorting and pagination work on the result", () => {
  const ids = (criteria) => L.filterCards(cards, criteria, prices).map((c) => c.cardId);
  assert.deepStrictEqual(ids({ minPrice: 100, maxPrice: 500 }), ["c2"]);
  assert.deepStrictEqual(ids({ minPrice: 0 }), ["c3", "c2", "c1"]);
  assert.deepStrictEqual(ids({ maxPrice: 60 }), ["c1"]);
  assert.deepStrictEqual(ids({ sort: "price-desc" }), ["c3", "c2", "c1", "c4"]);
  assert.deepStrictEqual(ids({ sort: "price-asc" }), ["c1", "c2", "c3", "c4"]);
  assert.deepStrictEqual(ids({ sort: "name" }), ["c3", "c2", "c4", "c1"]);
  assert.deepStrictEqual(ids({ rarities: ["R"], minPrice: 1 }), ["c1"]);

  const items = Array.from({ length: 45 }, (_, i) => i);
  assert.deepStrictEqual(L.paginate(items, 1, 20), { items: items.slice(0, 20), page: 1, pages: 3, total: 45 });
  assert.strictEqual(L.paginate(items, 3, 20).items.length, 5);
  assert.strictEqual(L.paginate(items, 9, 20).page, 3);
  assert.strictEqual(L.paginate(items, 0, 20).page, 1);
  assert.deepStrictEqual(L.paginate([], 1, 20), { items: [], page: 1, pages: 1, total: 0 });
});

test("the site's tag labels are reduced to a stable name", () => {
  assert.strictEqual(L.tagFromLabel("Toutes les étiquettes"), null);
  assert.strictEqual(L.tagFromLabel("  Sans étiquette "), L.NO_TAG);
  assert.strictEqual(L.tagFromLabel("#Test (1)"), "Test");
  assert.strictEqual(L.tagFromLabel("#Rue de Paris (128)"), "Rue de Paris");
  assert.strictEqual(L.tagFromLabel(""), null);
  assert.strictEqual(L.tagFromLabel(undefined), null);
});

test("untagged and favourites-first criteria", () => {
  const ids = (criteria) => L.filterCards(cards, criteria, prices).map((c) => c.cardId);
  assert.deepStrictEqual(ids({ untagged: true }), ["c3", "c4"]);
  const starred = cards.map((c) => (c.cardId === "c4" ? { ...c, copies: [{ id: "o5", starred: true }] } : c));
  assert.deepStrictEqual(L.filterCards(starred, { sort: "starred" }, prices).map((c) => c.cardId), ["c4", "c3", "c2", "c1"]);
});

test("progress line shows percent, elapsed, a pace-based remaining time and the site pause", () => {
  assert.strictEqual(L.formatDuration(65000), "1:05");
  assert.strictEqual(L.formatDuration(3725000), "1:02:05");
  const stamps = [0, 2000, 4000, 6000, 8000];
  const line = L.progressLine({ done: 5, total: 25, startedAt: 0, stamps, now: 10000, pauseMs: 4200 });
  assert.strictEqual(line, "Prix 5/25 (20 %) | écoulé 0:10 | reste ~0:50 | 24.0 prix/min | pause du site 5 s");
  assert.match(L.progressLine({ done: 0, total: 3, startedAt: 0, stamps: [], now: 1000 }), /reste \?$/);
});

test("estimateTotals adds price times copies by rarity and counts the cards without a price", () => {
  const cards = [
    { cardId: "a", rarity: "R", copies: [{}, {}] },
    { cardId: "b", rarity: "C", copies: [{}] },
    { cardId: "c", rarity: "C", copies: [{}] },
  ];
  const prices = { a: { averages: { R: 10 } }, b: { averages: { C: 3 } } };
  assert.deepStrictEqual(L.estimateTotals(cards, prices), { value: 23, copies: 4, priced: 2, unpriced: 1, byRarity: { R: 20, C: 3 } });
});

test("auctions are read from the listing and the detail payloads, and the next bid is the base or one above the current", () => {
  const listing = L.auctionsFromPayload("/api/marketplace", {
    auctions: [
      { id: "a1", base_amount: 7, current_bid: null, effective_bid: 7, status: "active", seller: { username: "S" }, card: { wikipedia_title: "T" } },
      { id: "a2", base_amount: 20, current_bid: 25, effective_bid: 25, status: "active", seller: { username: "S" }, card: { wikipedia_title: "U" } },
    ],
  });
  assert.strictEqual(L.auctionsFromPayload("/api/marketplace/mine", { bids: [{ auction: { id: "a9", base_amount: 3, status: "active", card: { wikipedia_title: "W" } } }] })[0].id, "a9");
  assert.strictEqual(L.minimumFromMessage("Mise trop basse, minimum 12 W", 11), 12);
  assert.strictEqual(L.minimumFromMessage("Mise trop basse", 11), null);
  assert.strictEqual(L.minimumFromMessage("Au moins 10 % de plus : minimum 6 W", 5), 6);
  assert.strictEqual(L.minimumFromMessage("La mise doit augmenter de 10 %", 5), null);
  assert.deepStrictEqual(listing.map((auction) => L.nextBid(auction)), [7, 28]);
  const step = (current) => L.nextBid({ current, base: 1, minimum: null });
  assert.deepStrictEqual([5, 19, 100, 101, 1].map(step), [6, 21, 110, 112, 2]);
  assert.strictEqual(L.nextBid({ current: 100, base: 1, minimum: 115 }), 115);
  assert.strictEqual(L.nextBid({ current: 100, base: 1, minimum: 105 }), 110);
  assert.strictEqual(listing[0].title, "T");
  assert.strictEqual(L.auctionsFromPayload("/api/marketplace/x", { auction: { id: "a3", base_amount: 1, status: "active", card: { wikipedia_title: "V" } } })[0].id, "a3");
  assert.deepStrictEqual(L.auctionsFromPayload("/api/cards", { cards: [] }), []);
});
