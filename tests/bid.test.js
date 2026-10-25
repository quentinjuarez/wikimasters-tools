const { test, after } = require("node:test");
const assert = require("node:assert");
const { closeAll, createPage, sleep, until } = require("./helpers.js");

after(closeAll);

const BID_MARKET = `
  <main><h1>Marché</h1><div class="grid">
    <div class="flex flex-col items-center gap-2.5" id="tile1">
      <div class="w-40 relative rounded-2xl overflow-hidden" id="inner1"><div class="absolute top-2 left-2">R</div><div><h3>Élysée</h3><div class="mt-auto"><div class="border-t">1 2</div></div></div></div>
      <div>Mise de départ7Durée5h 59m</div>
      <div>Vendu par Ambercowboy</div>
    </div>
    <div class="flex flex-col items-center gap-2.5" id="tile2">
      <div class="w-40 relative rounded-2xl overflow-hidden" id="inner2"><div class="absolute top-2 left-2">C</div><div><h3>Lyon</h3><div class="mt-auto"><div class="border-t">3 4</div></div></div></div>
      <div>Mise de départ20Durée1h</div>
      <div>Vendu par Autre</div>
    </div>
  </div></main>`;

const bidListing = {
  auctions: [
    { id: "a1", card_id: "c1", base_amount: 7, current_bid: null, effective_bid: 7, status: "active", snapshot_rarity: "R", seller: { username: "Ambercowboy" }, card: { id: "c1", wikipedia_title: "Élysée", rarity: "R" } },
    { id: "a2", card_id: "c2", base_amount: 20, current_bid: 25, effective_bid: 25, status: "active", snapshot_rarity: "C", seller: { username: "Autre" }, card: { id: "c2", wikipedia_title: "Lyon", rarity: "C" } },
  ],
};

test("marketplace Parcourir: each auction gets a bid button for the minimum bid, one click places exactly one bid", async () => {
  const posts = [];
  const page = createPage([], {
    html: BID_MARKET,
    post: (body, ok, url) => (posts.push({ url, body }), ok({ auction_id: "a1", current_bid: 7, bidder_balance: 3 })),
  });
  await sleep(50);
  page.hook("/api/marketplace", bidListing);
  const doc = page.w.document;
  await until(() => doc.querySelectorAll(".wmt-bid").length === 2);
  assert.deepStrictEqual(page.text(".wmt-bid"), ["Enchérir 7 W", "Enchérir 28 W"]);

  const first = doc.querySelector("#inner1 .mt-auto .wmt-bid");
  first.click();
  first.click();
  await until(() => first.dataset.state === "done");
  assert.deepStrictEqual(posts, [{ url: "/api/marketplace/a1/bid", body: { amount: 7 } }]);
  assert.strictEqual(first.textContent, "Tu mènes à 7 W");
});

test("a bid refused by the site shows its message, and an anti-bot refusal opens the auction page", async () => {
  let clicks = 0;
  let mode = "broke";
  const page = createPage([], {
    html: BID_MARKET,
    post: () =>
      mode === "broke"
        ? { ok: false, status: 400, headers: { get: () => null }, json: async () => ({ error: "Solde insuffisant" }) }
        : { ok: false, status: 403, headers: { get: () => null }, json: async () => ({ code: "human_verification_required", error: "Vérification anti-bot requise." }) },
  });
  await sleep(50);
  const doc = page.w.document;
  doc.querySelector("#inner1").addEventListener("click", () => (clicks += 1));
  page.hook("/api/marketplace", bidListing);
  await until(() => doc.querySelector("#inner1 .wmt-bid"));
  const button = doc.querySelector("#inner1 .wmt-bid");
  button.click();
  await until(() => button.dataset.state === "error");
  assert.strictEqual(button.textContent, "Solde insuffisant");
  assert.strictEqual(clicks, 0);

  mode = "human";
  button.dataset.state = "";
  delete button.dataset.state;
  button.disabled = false;
  button.click();
  await until(() => clicks === 1);
  assert.strictEqual(button.textContent, "Vérification requise");
});

test("without a minimum in the refusal message, the refreshed auction gives current plus 10 percent rounded up", async () => {
  const posts = [];
  let step = 0;
  const page = createPage([], {
    html: BID_MARKET,
    post: (body) => (posts.push(body.amount), ++step === 1 ? { ok: false, status: 400, headers: { get: () => null }, json: async () => ({ error: "Mise trop basse" }) } : { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ current_bid: body.amount }) }),
    get: (pathname, ok) =>
      pathname === "/api/marketplace/a1"
        ? ok({ auction: { id: "a1", base_amount: 7, current_bid: 11, effective_bid: 11, status: "active", seller: { username: "Ambercowboy" }, card: { wikipedia_title: "Élysée" } } })
        : null,
  });
  await sleep(50);
  page.hook("/api/marketplace", bidListing);
  const doc = page.w.document;
  await until(() => doc.querySelector("#inner1 .wmt-bid"));
  const button = doc.querySelector("#inner1 .wmt-bid");
  button.click();
  await until(() => button.dataset.state === "updated");
  assert.strictEqual(button.textContent, "Enchérir 13 W");
  button.click();
  await until(() => button.dataset.state === "done");
  assert.deepStrictEqual(posts, [7, 13]);
});
