const { test, after } = require("node:test");
const assert = require("node:assert");
const { IDBFactory } = require("fake-indexeddb");
const { COLLECTION, closeAll, createPage, listing, owned, sleep, until } = require("./helpers.js");

after(closeAll);

test("collection page: sale strip, no stats footer, one click lists the card with the chosen settings", async () => {
  const requests = [];
  const posts = [];
  const page = createPage(requests, {
    html: COLLECTION,
    pathname: "/collection",
    post: (body, ok) => (posts.push(body), ok({ id: "auction" })),
  });
  await sleep(50);
  page.hook("/api/my-collection", { collection: [owned("o1", true), owned("o2")] });
  await until(() => page.w.document.querySelector(".wmt-sell"));
  const doc = page.w.document;
  assert.ok(doc.querySelector("#card1").classList.contains("wmt-collection"));
  assert.strictEqual(doc.querySelector(".wmt-strip").previousElementSibling.querySelector("h1").textContent, "Collection");

  const amount = doc.querySelector(".wmt-amount");
  amount.value = "25";
  amount.dispatchEvent(new page.w.Event("input", { bubbles: true }));
  const duration = doc.querySelector(".wmt-duration");
  duration.value = "60";
  duration.dispatchEvent(new page.w.Event("change", { bubbles: true }));
  assert.match(doc.querySelector(".wmt-sell").textContent, /Vendre 25 W/);

  doc.querySelector(".wmt-sell").click();
  await until(() => posts.length === 1);
  assert.deepStrictEqual(posts[0], { card_id: "o2", base_amount: 25, duration_minutes: 60 });
  await until(() => doc.querySelector(".wmt-sell").dataset.state === "done");
  assert.ok(doc.querySelector("#card1").classList.contains("wmt-sold"));
  assert.strictEqual(requests.filter((r) => r === "/api/marketplace").length, 1);
});

test("a starred copy needs a second click and an ownership error drops that copy", async () => {
  const posts = [];
  const page = createPage([], {
    html: COLLECTION,
    pathname: "/collection",
    post: (body) => (posts.push(body), { ok: false, status: 400, headers: { get: () => null }, json: async () => ({ error: "Vous ne possédez pas cette carte" }) }),
  });
  await sleep(50);
  page.hook("/api/my-collection", { collection: [owned("o1", true)] });
  await until(() => page.w.document.querySelector(".wmt-sell"));
  const button = page.w.document.querySelector(".wmt-sell");
  button.click();
  await until(() => button.dataset.state === "confirm");
  assert.strictEqual(posts.length, 0);
  button.click();
  await until(() => posts.length === 1 && button.dataset.state === "error");
  assert.match(button.title, /possédez pas/);
  assert.strictEqual(page.w.WMT.registry.owned("c1").length, 0);
});

test("anti-bot refusal on sale falls back to the auction modal, filled with the sale settings", async () => {
  const page = createPage([], {
    html: COLLECTION,
    pathname: "/collection",
    post: () => ({ ok: false, status: 403, headers: { get: () => null }, json: async () => ({ code: "human_verification_required", error: "Vérification anti-bot requise." }) }),
  });
  await sleep(50);
  page.hook("/api/my-collection", { collection: [owned("o2")] });
  await until(() => page.w.document.querySelector(".wmt-sell"));
  const doc = page.w.document;
  const amount = doc.querySelector(".wmt-amount");
  amount.value = "25";
  amount.dispatchEvent(new page.w.Event("input", { bubbles: true }));
  const duration = doc.querySelector(".wmt-duration");
  duration.value = "180";
  duration.dispatchEvent(new page.w.Event("change", { bubbles: true }));

  const picked = [];
  doc.querySelector("#card1").addEventListener("click", () => {
    const open = doc.createElement("button");
    open.textContent = "Mettre aux enchères";
    open.addEventListener("click", () => {
      const modal = doc.createElement("div");
      modal.id = "modal";
      modal.innerHTML = '<input type="number" value="10"><button>1 h</button><button>3 h</button><button id="go">Lancer l\'enchère</button>';
      modal.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => picked.push(b.textContent)));
      doc.body.append(modal);
    });
    doc.body.append(open);
  });

  const button = doc.querySelector(".wmt-sell");
  button.click();
  await until(() => doc.getElementById("go") && button.dataset.state === "busy");
  assert.strictEqual(doc.querySelector("#modal input").value, "25");
  assert.deepStrictEqual(picked, ["3 h"]);
  doc.getElementById("go").click();
  doc.getElementById("modal").remove();
  await until(() => button.dataset.state === "done");
  assert.strictEqual(page.w.WMT.registry.owned("c1").length, 0);
});

test("no sale strip or button outside the collection", async () => {
  const page = createPage([]);
  await sleep(50);
  page.hook("/api/marketplace", listing);
  await until(() => page.w.document.querySelectorAll(".wmt-badge").length === 2);
  assert.strictEqual(page.w.document.querySelectorAll(".wmt-sell, .wmt-strip").length, 0);
});

test("the sale toggle hides the sell buttons, brings the stats footer back and is remembered", async () => {
  const idb = new IDBFactory();
  const page = createPage([], { html: COLLECTION, pathname: "/collection", idb, post: (body, ok) => ok({}) });
  await sleep(50);
  page.hook("/api/my-collection", { collection: [owned("o2")] });
  const doc = page.w.document;
  await until(() => doc.querySelector(".wmt-sell"));
  const toggle = [...doc.querySelectorAll(".wmt-strip input[type=checkbox]")][0];
  assert.strictEqual(toggle.checked, true);
  assert.strictEqual(doc.body.classList.contains("wmt-hide-sell"), false);

  toggle.checked = false;
  toggle.dispatchEvent(new page.w.Event("change", { bubbles: true }));
  assert.strictEqual(doc.body.classList.contains("wmt-hide-sell"), true);
  assert.strictEqual((await page.w.WMT.store.get("sale")).visible, false);

  const reloaded = createPage([], { html: COLLECTION, pathname: "/collection", idb, post: (body, ok) => ok({}) });
  await sleep(100);
  reloaded.hook("/api/my-collection", { collection: [owned("o2")] });
  await until(() => reloaded.w.document.querySelector(".wmt-strip"));
  assert.strictEqual(reloaded.w.document.body.classList.contains("wmt-hide-sell"), true);
  assert.strictEqual(reloaded.w.document.querySelector(".wmt-strip input[type=checkbox]").checked, false);
});
