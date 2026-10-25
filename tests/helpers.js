const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { IDBFactory } = require("fake-indexeddb");

const root = path.join(__dirname, "..");

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));

const appScripts = manifest.content_scripts[1].js;

const CARDS = `
  <main><div id="grid">
    <div class="w-40 relative rounded-2xl overflow-hidden cursor-pointer">
      <div class="absolute top-2 left-2 px-2 rounded-md text-xs font-bold z-30">R</div>
      <div class="absolute top-[45%]"><h3>Élysée</h3></div>
    </div>
    <div class="w-40 relative rounded-2xl overflow-hidden cursor-pointer">
      <div class="absolute top-2 left-2 px-2 rounded-md text-xs font-bold z-30">C</div>
      <div class="absolute top-[45%]"><h3>Lyon</h3></div>
    </div>
  </div></main>`;

async function seed(w, { cards, rarities, prices }) {
  await w.WMT.store.putMany("cards", cards);
  await w.WMT.store.set("collection-meta", { rarities, tagMeta: {}, tagOptions: [], savedAt: Date.now() });
  await w.WMT.store.putMany("prices", Object.entries(prices).map(([id, entry]) => ({ id, ...entry })));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, ms = 5000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (check()) return;
    await sleep(20);
  }
  throw new Error(`timeout: ${check}`);
}

const COLLECTION = `
  <main><div class="flex-1"><div class="flex items-center justify-between gap-3 animate-fade-in-up"><h1>Collection</h1></div>
    <div id="grid">
      <div class="w-40 relative rounded-2xl overflow-hidden cursor-pointer" id="card1">
        <div class="absolute top-2 left-2 px-2 rounded-md text-xs font-bold z-30">R</div>
        <div class="absolute top-[45%]"><h3>Élysée</h3>
          <div class="mt-auto flex w-full flex-col"><div class="flex w-full border-t border-black/20" id="stats">3085 2300</div></div>
        </div>
      </div>
    </div></div></main>`;

const pages = [];

function createPage(requests, { html = CARDS, pathname = "/marketplace", post, sales, get, idb = new IDBFactory() } = {}) {
  const dom = new JSDOM(`<body>${html}</body>`, { url: `https://www.wiki-masters.com${pathname}`, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  pages.push(w);
  w.indexedDB = idb;
  w.Element.prototype.scrollIntoView = () => {};
  w.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe(target) {
      setTimeout(() => this.callback([{ target, isIntersecting: true }]), 0);
    }
    unobserve() {}
  };
  const rarities = { L: 1, UR: 0, SR: 0, R: 2, PC: 0, C: 3 };
  w.fetch = async (url, options = {}) => {
    const u = new URL(url, "https://www.wiki-masters.com");
    requests.push(u.pathname + u.search);
    const ok = (body) => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => body });
    if (options.method === "POST") return post(JSON.parse(options.body), ok, u.pathname);
    if (get) {
      const custom = get(u.pathname, ok);
      if (custom) return custom;
    }
    if (u.pathname.endsWith("/sales")) {
      const id = u.pathname.split("/")[4];
      if (sales) {
        const custom = sales(id, ok);
        if (custom) return custom;
      }
      return ok({ summary: id === "c1" ? { R: { average: 1200 } } : { C: { average: 7 } } });
    }
    if (u.pathname === "/api/my-collection") {
      const entry = (n, rarity) => ({ id: `o${n}`, card_id: `c${n}`, starred: false, tags: [], card: { wikipedia_title: `Carte ${n}`, rarity } });
      return ok({ collection: [entry(10, "L"), entry(11, "R"), entry(12, "R")], total: 6, rarityCounts: rarities, tagOptions: [] });
    }
    return { ok: false, status: 404, headers: { get: () => null }, json: async () => ({}) };
  };
  for (const file of appScripts) w.eval(fs.readFileSync(path.join(root, file), "utf8"));
  const hook = (pathname, json) => w.dispatchEvent(new w.MessageEvent("message", { data: { source: "wmt-hook", path: pathname, json }, origin: w.location.origin, source: w }));
  return { w, hook, text: (selector) => [...w.document.querySelectorAll(selector)].map((node) => node.textContent.replace(/\s/g, " ")) };
}

const listing = { auctions: [
  { card_id: "c1", snapshot_rarity: "R", card: { id: "c1", wikipedia_title: "Élysée", rarity: "R" } },
  { card_id: "c2", snapshot_rarity: "C", card: { id: "c2", wikipedia_title: "Lyon", rarity: "C" } },
] };

const owned = (id, starred = false) => ({ id, card_id: "c1", starred, tags: [], card: { wikipedia_title: "Élysée", rarity: "R" } });

const MARKET = `
  <main><div class="flex-1"><div class="flex items-center justify-between gap-3 animate-fade-in-up"><h1>Marché</h1></div>
  <div id="grid">
    <div class="w-40 relative rounded-2xl overflow-hidden"><div class="absolute top-2 left-2">R</div><div><h3>Élysée</h3></div></div>
    <div class="w-40 relative rounded-2xl overflow-hidden" id="inner2"><div class="absolute top-2 left-2">C</div><div><h3>Lyon</h3><div class="mt-auto"><div class="border-t">3 4</div></div></div></div>
  </div></div></main>`;

const FILTER_UI = `
  <main><div class="flex-1"><div class="flex items-center justify-between gap-3 animate-fade-in-up"><h1>Collection</h1></div>
  <div class="space-y-3 animate-fade-in-up" id="filters">
    <input type="text" placeholder="Rechercher par titre ou catégorie">
    <button type="button" aria-label="Filtrer par étiquette" aria-haspopup="listbox" aria-expanded="false" aria-controls="lb-tags">Toutes les étiquettes</button>
    <button type="button" aria-label="Trier la collection" aria-haspopup="listbox" aria-expanded="false" aria-controls="lb-sort">Rareté</button>
    ${["L", "UR", "SR", "R", "PC", "C"].map((r) => `<button type="submit" class="px-3 py-1 rounded-full opacity-50">${r}</button>`).join("")}
  </div>
  <div class="scroll-mt-4 space-y-3"><div class="flex flex-wrap"></div></div></div></main>`;

function wireSiteFilters(w) {
  const doc = w.document;
  const dropdowns = [
    ["Filtrer par étiquette", "lb-tags", ["Toutes les étiquettes", "Sans étiquette", "#Test (1)", "#Autre (4)"]],
    ["Trier la collection", "lb-sort", ["Rareté", "Nom", "Favoris", "Date d'ajout"]],
  ];
  for (const [label, id, options] of dropdowns) {
    const trigger = doc.querySelector(`button[aria-label="${label}"]`);
    trigger.addEventListener("click", () => {
      const open = doc.getElementById(id);
      if (open) {
        open.remove();
        trigger.setAttribute("aria-expanded", "false");
        return;
      }
      trigger.setAttribute("aria-expanded", "true");
      const list = doc.createElement("ul");
      list.id = id;
      for (const text of options) {
        const item = doc.createElement("button");
        item.setAttribute("role", "option");
        item.textContent = text;
        item.addEventListener("click", () => {
          trigger.textContent = text;
          trigger.setAttribute("aria-expanded", "false");
          doc.getElementById(id)?.remove();
        });
        const li = doc.createElement("li");
        li.append(item);
        list.append(li);
      }
      doc.body.append(list);
    });
  }
  for (const chip of doc.querySelectorAll("#filters button.rounded-full")) {
    chip.addEventListener("click", () => chip.classList.toggle("opacity-50"));
  }
}

const closeAll = () => pages.forEach((page) => page.close());

module.exports = { root, manifest, appScripts, CARDS, seed, sleep, until, COLLECTION, pages, createPage, listing, owned, MARKET, FILTER_UI, wireSiteFilters, closeAll };
