const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { JSDOM } = require("jsdom");
const { IDBFactory } = require("fake-indexeddb");

const root = path.join(__dirname, "..");
const out = path.join(__dirname, "screenshots");
const work = path.join(__dirname, "_build");
const CHROME = process.env.CHROME_BIN ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const scripts = manifest.content_scripts[1].js.map((file) => fs.readFileSync(path.join(root, file), "utf8"));
const extensionCss = fs.readFileSync(path.join(root, "src/style.css"), "utf8");
const shellCss = fs.readFileSync(path.join(__dirname, "shell.css"), "utf8");
const fonts = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700&display=swap";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UNI_ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const TITLES = [
  ["Mont Blanc", "plus haut sommet des Alpes"], ["Tour Eiffel", "monument parisien en fer"], ["Marie Curie", "physicienne et chimiste"],
  ["Mer Méditerranée", "mer entre Europe et Afrique"], ["Albert Einstein", "physicien théoricien"], ["Léonard de Vinci", "peintre et ingénieur"],
  ["Opéra Garnier", "salle de spectacle parisienne"], ["Fleuve Amazone", "plus puissant fleuve du monde"], ["Jeanne d'Arc", "héroïne de la guerre de Cent Ans"],
  ["Pont du Gard", "aqueduc romain"], ["Nikola Tesla", "inventeur et ingénieur"], ["Cap Horn", "pointe sud de l'Amérique"],
  ["Château de Chambord", "château de la Loire"], ["Ada Lovelace", "pionnière de la programmation"], ["Mont Fuji", "volcan emblématique du Japon"],
  ["Vélodrome de Roubaix", "piste cycliste mythique"], ["Isaac Newton", "mathématicien et physicien"], ["Lac Léman", "lac alpin"],
  ["Cathédrale de Chartres", "chef-d'œuvre gothique"], ["Grand Canyon", "gorge du Colorado"], ["Victor Hugo", "poète et romancier"],
  ["Stade de France", "enceinte sportive"], ["Galilée", "astronome italien"], ["Delta du Rhône", "zone humide camarguaise"],
  ["Mur d'Hadrien", "fortification romaine"], ["Charles Darwin", "naturaliste britannique"], ["Pic du Midi", "observatoire pyrénéen"],
  ["Palais des Papes", "résidence pontificale d'Avignon"], ["Rosalind Franklin", "chimiste et cristallographe"], ["Île de Pâques", "île du Pacifique"],
  ["Abbaye de Cluny", "ancien monastère bourguignon"], ["Alan Turing", "mathématicien et cryptologue"], ["Gorges du Verdon", "canyon provençal"],
  ["Pyramide du Louvre", "entrée du musée"], ["Johannes Kepler", "astronome allemand"], ["Baie de Somme", "estuaire picard"],
  ["Citadelle de Lille", "forteresse de Vauban"], ["Hedy Lamarr", "actrice et inventrice"], ["Lac d'Annecy", "lac savoyard"],
  ["Dune du Pilat", "plus haute dune d'Europe"], ["Blaise Pascal", "mathématicien et philosophe"], ["Pont Neuf", "plus ancien pont de Paris"],
  ["Mont Ventoux", "géant de Provence"], ["Louis Pasteur", "chimiste et biologiste"], ["Phare de Cordouan", "phare de l'estuaire"],
  ["Grotte Chauvet", "grotte ornée"], ["Émilie du Châtelet", "mathématicienne et physicienne"], ["Cirque de Gavarnie", "cirque glaciaire"],
  ["Bibliothèque de Lyon", "grande bibliothèque"], ["James Watt", "ingénieur écossais"], ["Aiguille du Midi", "sommet du massif du Mont-Blanc"],
  ["Hôtel de Ville", "mairie monumentale"], ["Henrietta Leavitt", "astronome américaine"], ["Calanques", "massif côtier"],
  ["Pont de Normandie", "pont à haubans"], ["Évariste Galois", "mathématicien"], ["Forêt de Fontainebleau", "massif forestier"],
];
const RARITY_CYCLE = ["L", "UR", "SR", "R", "R", "SR", "R", "UR", "R", "R", "SR", "R"];

function makeCards(count) {
  return Array.from({ length: count }, (_, index) => {
    const [title, desc] = TITLES[index % TITLES.length];
    const rarity = RARITY_CYCLE[index % RARITY_CYCLE.length];
    return {
      cardId: UNI_ID(index + 1),
      title,
      desc,
      rarity,
      atk: 2800 + ((index * 937) % 5200),
      def: 2600 + ((index * 611) % 5400),
      copies: [{ id: UNI_ID(1000 + index), starred: index % 17 === 0 }],
      tags: index % 4 === 0 ? [{ id: "t1", name: "A VENDRE" }] : index % 5 === 0 ? [{ id: "t2", name: "FAVORIS" }] : [],
    };
  });
}

const BASE = { L: 1450, UR: 380, SR: 130, R: 46, PC: 12, C: 4 };
function priceOf(card, index) {
  const factor = 0.55 + (((index * 53) % 90) / 100) * 1.2;
  return Math.max(2, Math.round(BASE[card.rarity] * factor));
}

function cardHtml(card, extra = "") {
  return `<div class="relative rounded-2xl overflow-hidden card" data-r="${card.rarity}">
    <div class="rar">${card.rarity}</div><div class="art"></div>
    <div class="body"><h3>${card.title}</h3><p>${card.desc}</p>
      <div class="mt-auto"><div class="border-t stats"><span>${card.atk}</span><span>${card.def}</span></div></div>
    </div>${extra}</div>`;
}

const NAV = ["Paquets", "Collection", "Échanges", "Marché", "Profil", "Toutes les cartes", "Guilde", "Amis", "Messages", "Bataille", "Succès", "Classement"];
const shellPage = (active, mainHtml) => `<div class="app"><aside class="side"><div class="logo">Wiki<b>Masters</b></div>${NAV.map(
  (label) => `<div class="nav${label === active ? " on" : ""}"><i></i>${label}</div>`,
).join("")}</aside><main>${mainHtml}</main></div>`;

const filterBlock = (sortLabel) => `<div class="space-y-3 animate-fade-in-up filters" id="filters">
  <input type="text" placeholder="Rechercher par titre ou catégorie">
  <button type="button" aria-label="Filtrer par étiquette" aria-haspopup="listbox" aria-expanded="false" aria-controls="lb-tags">Toutes les étiquettes</button>
  <button type="button" aria-label="Trier la collection" aria-haspopup="listbox" aria-expanded="false" aria-controls="lb-sort">${sortLabel}</button>
  ${["L", "UR", "SR", "R", "PC", "C"].map((r) => `<button type="submit" class="px-3 py-1 rounded-full ${["L", "UR", "SR", "R"].includes(r) ? "" : "opacity-50"}">${r}</button>`).join("")}
</div>`;

function wireDropdowns(w) {
  const doc = w.document;
  const dropdowns = [
    ["Filtrer par étiquette", "lb-tags", ["Toutes les étiquettes", "Sans étiquette", "A VENDRE", "FAVORIS"]],
    ["Trier la collection", "lb-sort", ["Rareté", "Nom", "Favoris", "Date d'ajout"]],
  ];
  for (const [label, id, options] of dropdowns) {
    const trigger = doc.querySelector(`button[aria-label="${label}"]`);
    trigger.addEventListener("click", () => {
      const open = doc.getElementById(id);
      if (open) return open.remove();
      const list = doc.createElement("ul");
      list.id = id;
      for (const text of options) {
        const item = doc.createElement("button");
        item.setAttribute("role", "option");
        item.textContent = text;
        item.addEventListener("click", () => {
          trigger.textContent = text;
          doc.getElementById(id)?.remove();
        });
        const li = doc.createElement("li");
        li.append(item);
        list.append(li);
      }
      doc.body.append(list);
    });
  }
  for (const chip of doc.querySelectorAll("#filters button.rounded-full")) chip.addEventListener("click", () => chip.classList.toggle("opacity-50"));
}

async function openWindow({ html, pathname, idb, fetchImpl }) {
  const dom = new JSDOM(`<!doctype html><html><head></head><body>${html}</body></html>`, {
    url: `https://www.wiki-masters.com${pathname}`,
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  const w = dom.window;
  w.indexedDB = idb;
  w.IntersectionObserver = class {
    constructor(callback) {
      this.callback = callback;
    }
    observe(target) {
      setTimeout(() => this.callback([{ target, isIntersecting: true }]), 0);
    }
    unobserve() {}
  };
  w.fetch = fetchImpl;
  w.Element.prototype.scrollIntoView = () => {};
  for (const source of scripts) w.eval(source);
  return { dom, w, hook: (apiPath, json) => w.dispatchEvent(new w.MessageEvent("message", { data: { source: "wmt-hook", path: apiPath, json }, origin: w.location.origin, source: w })) };
}

const jsonResponse = (body, status = 200) => ({ ok: status < 400, status, headers: { get: () => null }, json: async () => body });

async function scene({ name, active, pathname, html, cards, prices, collectionCounts, tagOptions, hooks, fetchExtra, steps }) {
  const idb = new IDBFactory();
  const seeder = await openWindow({ html: "<main></main>", pathname, idb, fetchImpl: async () => jsonResponse({}, 404) });
  const rarities = Object.fromEntries(
    Object.entries(collectionCounts).map(([rarity, count]) => [rarity, { serverCount: count, loaded: count, syncedAt: Date.now() }]),
  );
  await seeder.w.WMT.store.putMany("cards", cards.map(({ desc, atk, def, ...card }) => card));
  await seeder.w.WMT.store.set("collection-meta", { rarities, tagMeta: {}, tagOptions, savedAt: Date.now() - 3 * 3600 * 1000 });
  await seeder.w.WMT.store.putMany(
    "prices",
    Object.entries(prices).map(([id, entry]) => ({ id, ...entry })),
  );
  seeder.w.close();

  const sales = new Map();
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url, "https://www.wiki-masters.com");
    if (fetchExtra) {
      const custom = await fetchExtra(u, options);
      if (custom) return custom;
    }
    if (u.pathname === "/api/my-collection") {
      return jsonResponse({ collection: [], total: Object.values(collectionCounts).reduce((a, b) => a + b, 0), rarityCounts: collectionCounts, tagOptions });
    }
    return jsonResponse({}, 404);
  };
  const page = await openWindow({ html: shellPage(active, html), pathname, idb, fetchImpl });
  page.w.document.querySelector("#filters") && wireDropdowns(page.w);
  await sleep(150);
  for (const [apiPath, json] of hooks) page.hook(apiPath, json);
  await steps?.(page);
  const dom = page.dom;
  const doc = page.w.document;
  for (const input of doc.querySelectorAll("input")) {
    if (input.type === "checkbox") input.toggleAttribute("checked", input.checked);
    else input.setAttribute("value", input.value);
  }
  for (const option of doc.querySelectorAll("option")) option.toggleAttribute("selected", option.selected);
  const html2 = dom
    .serialize()
    .replace("<head></head>", `<head><meta charset="utf-8"><link rel="stylesheet" href="${fonts}"><style>${shellCss}\n${extensionCss}</style></head>`);
  fs.writeFileSync(path.join(work, `${name}.html`), html2);
  page.w.close();
  void sales;
}

function shoot(name, width, height, file = name) {
  const target = path.join(out, `${file}.png`);
  execFileSync(
    CHROME,
    ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${width},${height}`, "--virtual-time-budget=6000", `--screenshot=${target}`, `file://${path.join(work, `${name}.html`)}`],
    { stdio: "ignore" },
  );
  return target;
}

const collectionEntry = (card) => ({ id: card.copies[0].id, card_id: card.cardId, starred: card.copies[0].starred, tags: card.tags, card: { id: card.cardId, wikipedia_title: card.title, rarity: card.rarity } });

async function main() {
  fs.mkdirSync(out, { recursive: true });
  fs.mkdirSync(work, { recursive: true });
  const cards = makeCards(56);
  const counts = cards.reduce((acc, card) => ({ ...acc, [card.rarity]: (acc[card.rarity] ?? 0) + 1 }), {});
  const tagOptions = [
    { id: "t1", name: "A VENDRE", cardCount: cards.filter((card) => card.tags.some((tag) => tag.id === "t1")).length },
    { id: "t2", name: "FAVORIS", cardCount: cards.filter((card) => card.tags.some((tag) => tag.id === "t2")).length },
  ];
  const fullPrices = Object.fromEntries(cards.map((card, index) => [card.cardId, { averages: { [card.rarity]: priceOf(card, index) }, fetchedAt: Date.now() - index * 600000, title: card.title, rarity: card.rarity }]));
  const base = { cards, collectionCounts: counts, tagOptions };

  const gridCards = cards.slice(0, 10);
  const collectionMain = `<div class="flex-1"><div class="flex items-center justify-between gap-3 animate-fade-in-up head"><h1>Collection</h1></div><p class="sub">${cards.length} cartes</p>
    ${filterBlock("Rareté")}
    <div class="scroll-mt-4 space-y-3"><div class="flex flex-wrap grid">${gridCards.map((card) => cardHtml(card)).join("")}</div></div></div>`;

  await scene({
    ...base,
    name: "01-collection",
    active: "Collection",
    pathname: "/collection",
    html: collectionMain,
    prices: fullPrices,
    hooks: [["/api/my-collection", { collection: cards.map(collectionEntry) }]],
    steps: async () => sleep(1200),
  });

  const partial = Object.fromEntries(Object.entries(fullPrices).filter((_, index) => index < 22 || index > 49));
  await scene({
    ...base,
    name: "02-estimation",
    active: "Collection",
    pathname: "/collection",
    html: collectionMain,
    prices: partial,
    hooks: [["/api/my-collection", { collection: cards.map(collectionEntry) }]],
    fetchExtra: async (u) => {
      const match = u.pathname.match(/^\/api\/marketplace\/cards\/([^/]+)\/sales$/);
      if (!match) return null;
      await sleep(260);
      const card = cards.find((entry) => entry.cardId === match[1]);
      return jsonResponse({ summary: { [card.rarity]: { average: priceOf(card, cards.indexOf(card)) } } });
    },
    steps: async ({ w }) => {
      await sleep(300);
      w.document.querySelector(".wmt-bar").click();
      await sleep(400);
      const run = [...w.document.querySelectorAll(".wmt-panel .wmt-btn")].find((node) => /Estimer ma sélection/.test(node.textContent));
      run.click();
      await sleep(3600);
    },
  });

  const auctions = cards.slice(0, 10).map((card, index) => ({
    id: `a${index + 1}`,
    card_id: card.cardId,
    base_amount: Math.max(2, Math.round(priceOf(card, index) * 0.5)),
    current_bid: index % 3 === 1 ? Math.round(priceOf(card, index) * 0.6) : null,
    effective_bid: Math.round(priceOf(card, index) * 0.55),
    status: "active",
    snapshot_rarity: card.rarity,
    seller: { username: ["Aurore", "Basile", "Camille", "Dorian", "Élodie", "Fabien", "Gaëlle", "Hugo", "Inès", "Jules"][index] },
    card: { id: card.cardId, wikipedia_title: card.title, rarity: card.rarity },
  }));
  const tiles = auctions
    .map((auction, index) => {
      const shown = auction.current_bid ?? auction.base_amount;
      return `<div class="flex flex-col items-center gap-2.5 card-frame tile">${cardHtml(cards[index])}<div class="meta">${auction.current_bid ? "Mise actuelle" : "Mise de départ"}<b>${shown}</b>Durée ${1 + (index % 5)}h ${10 + index * 4}m</div><div class="meta">Vendu par ${auction.seller.username}</div></div>`;
    })
    .join("");
  await scene({
    ...base,
    name: "03-marche",
    active: "Marché",
    pathname: "/marketplace",
    html: `<div class="flex-1"><div class="flex items-center justify-between gap-3 animate-fade-in-up head"><h1>Marché</h1></div><p class="sub">Enchérissez sur des cartes ou vendez les vôtres contre des wikibidous.</p>
      <div class="tabs"><span class="on">Parcourir</span><span>Mes ventes</span><span>Mes enchères</span><span>Gagnées</span><span>Historique</span></div>
      <div class="grid">${tiles}</div></div>`,
    prices: fullPrices,
    hooks: [["/api/marketplace", { auctions }]],
    steps: async () => sleep(1200),
  });

  await scene({
    ...base,
    name: "04-tri-par-prix",
    active: "Collection",
    pathname: "/collection",
    html: `<div class="flex-1"><div class="flex items-center justify-between gap-3 animate-fade-in-up head"><h1>Collection</h1></div><p class="sub">${cards.length} cartes</p>
      ${filterBlock("Rareté")}
      <div class="scroll-mt-4 space-y-3"><div class="flex flex-wrap grid">${gridCards.map((card) => cardHtml(card)).join("")}</div></div></div>`,
    prices: fullPrices,
    hooks: [["/api/my-collection", { collection: cards.map(collectionEntry) }]],
    steps: async ({ w }) => {
      await sleep(800);
      w.document.querySelector('button[aria-label="Trier la collection"]').click();
      await sleep(300);
      w.document.querySelector('[role="option"][data-wmt-option]').click();
      await sleep(900);
    },
  });

  const shots = [];
  for (const name of ["01-collection", "02-estimation", "03-marche", "04-tri-par-prix"]) shots.push(shoot(name, 1280, 800));
  console.log(shots.join("\n"));
}

if (require.main === module) main();
module.exports = { shoot, work, out };
