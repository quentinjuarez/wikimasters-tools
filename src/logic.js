(function (root) {
  const RARITIES = ["L", "UR", "SR", "R", "PC", "C"];
  const DEFAULT_RARITIES = ["L", "UR", "SR", "R"];
  const PAGE_SIZE = 50;
  const HOOKED_PATH = new RegExp(`^/api/(my-collection|cards|marketplace(/[\\w-]+){0,2}|packs/open|trades)$`, "i");

  const rank = (rarity) => {
    const index = RARITIES.indexOf(rarity);
    return index < 0 ? RARITIES.length : index;
  };

  function normalize(value) {
    return String(value ?? "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ")
      .toLowerCase()
      .trim();
  }

  function mergeTags(...lists) {
    const byKey = new Map();
    for (const list of lists) {
      for (const tag of list ?? []) byKey.set(tag.id || tag.name, tag);
    }
    return [...byKey.values()];
  }

  function mapEntry(entry) {
    const card = entry?.card;
    const cardId = entry?.card_id || card?.id;
    const title = card?.wikipedia_title;
    if (!entry?.id || !cardId || !title) return null;

    const tags = (Array.isArray(entry.tags) ? entry.tags : [])
      .map((raw) => {
        const tag = raw?.tag && typeof raw.tag === "object" ? raw.tag : raw;
        const name = String(tag?.name ?? "").trim();
        return name ? { id: tag?.id ? String(tag.id) : null, name } : null;
      })
      .filter(Boolean);

    return { ownedId: entry.id, cardId, title, rarity: card?.rarity ?? null, starred: entry.starred === true, tags };
  }

  function mapTagOptions(list) {
    return (Array.isArray(list) ? list : [])
      .map((raw) => {
        const tag = raw?.tag && typeof raw.tag === "object" ? raw.tag : raw;
        const name = String(tag?.name ?? "").trim();
        if (!name || !tag?.id) return null;
        const count = Number(tag.cardCount ?? raw?.cardCount);
        return { id: String(tag.id), name, cardCount: Number.isFinite(count) ? count : null };
      })
      .filter(Boolean);
  }

  const dedupeEntries = (mapped) => [...new Map(mapped.map((item) => [item.ownedId, item])).values()];

  function mergeCollection(mapped) {
    const byId = new Map();
    for (const item of dedupeEntries(mapped)) {
      const copy = { id: item.ownedId, starred: item.starred };
      const known = byId.get(item.cardId);
      if (!known) {
        byId.set(item.cardId, {
          cardId: item.cardId,
          title: item.title,
          rarity: item.rarity,
          copies: [copy],
          tags: item.tags,
        });
        continue;
      }
      known.copies.push(copy);
      known.tags = mergeTags(known.tags, item.tags);
    }
    return [...byId.values()];
  }

  const emptyCache = () => ({ cards: [], rarities: {}, tagMeta: {}, tagOptions: [], savedAt: 0 });

  function rarityPages(counts, rarities, pageSize = PAGE_SIZE) {
    const pages = new Set();
    let offset = 0;
    for (const rarity of RARITIES) {
      const count = Number(counts[rarity]) || 0;
      if (count > 0 && rarities.includes(rarity)) {
        const last = Math.floor((offset + count - 1) / pageSize);
        for (let page = Math.floor(offset / pageSize); page <= last; page += 1) pages.add(page);
      }
      offset += count;
    }
    return [...pages].sort((a, b) => a - b);
  }

  function rarityStatus(cache, counts, rarity) {
    const server = Number(counts[rarity]) || 0;
    const meta = cache.rarities[rarity];
    if (!meta) return server === 0 ? "ok" : "missing";
    return meta.serverCount === server ? "ok" : "changed";
  }

  function tagStatus(cache, tag) {
    const meta = cache.tagMeta[tag.id];
    if (!meta) return "missing";
    return tag.cardCount !== null && meta.serverCount !== tag.cardCount ? "changed" : "ok";
  }

  function applyRaritySync(cache, mapped, rarities, counts, now) {
    const synced = new Set(rarities);
    const entries = dedupeEntries(mapped).filter((item) => synced.has(item.rarity));
    const meta = { ...cache.rarities };
    for (const rarity of rarities) {
      meta[rarity] = {
        serverCount: Number(counts[rarity]) || 0,
        loaded: entries.filter((item) => item.rarity === rarity).length,
        syncedAt: now,
      };
    }
    return {
      ...cache,
      cards: [...cache.cards.filter((card) => !synced.has(card.rarity)), ...mergeCollection(entries)],
      rarities: meta,
      savedAt: now,
    };
  }

  function applyTagSync(cache, mapped, tag, now) {
    const entries = dedupeEntries(mapped);
    const cards = new Map(
      cache.cards.map((card) => [
        card.cardId,
        { ...card, tags: card.tags.filter((other) => other.id !== tag.id), copies: card.copies.map((copy) => ({ ...copy })) },
      ]),
    );

    for (const item of entries) {
      let card = cards.get(item.cardId);
      if (!card) {
        card = { cardId: item.cardId, title: item.title, rarity: item.rarity, copies: [], tags: [] };
        cards.set(item.cardId, card);
      }
      const known = card.copies.find((copy) => copy.id === item.ownedId);
      if (known) known.starred = item.starred;
      else card.copies.push({ id: item.ownedId, starred: item.starred });
      card.tags = mergeTags(card.tags, item.tags);
    }

    return {
      ...cache,
      cards: [...cards.values()],
      tagMeta: { ...cache.tagMeta, [tag.id]: { serverCount: tag.cardCount, loaded: entries.length, syncedAt: now } },
      savedAt: now,
    };
  }

  function removeCopies(cache, ownedIds) {
    const removed = new Set(ownedIds);
    const rarities = { ...cache.rarities };
    const tagMeta = { ...cache.tagMeta };
    const cards = [];

    for (const card of cache.cards) {
      const gone = card.copies.filter((copy) => removed.has(copy.id)).length;
      if (!gone) {
        cards.push(card);
        continue;
      }
      const meta = rarities[card.rarity];
      if (meta) {
        rarities[card.rarity] = {
          ...meta,
          serverCount: Math.max(0, meta.serverCount - gone),
          loaded: Math.max(0, meta.loaded - gone),
        };
      }
      for (const tag of card.tags) {
        const info = tagMeta[tag.id];
        if (info && info.serverCount !== null) tagMeta[tag.id] = { ...info, serverCount: Math.max(0, info.serverCount - gone) };
      }
      const copies = card.copies.filter((copy) => !removed.has(copy.id));
      if (copies.length) cards.push({ ...card, copies });
    }

    return { ...cache, cards, rarities, tagMeta };
  }

  function priceFor(card, prices) {
    const average = prices[card.cardId]?.averages?.[card.rarity];
    return Number.isFinite(average) ? average : null;
  }

  function selectForLoad(cards, prices) {
    return cards
      .filter((card) => !prices[card.cardId])
      .sort((a, b) => rank(a.rarity) - rank(b.rarity) || a.title.localeCompare(b.title, "fr"));
  }

  const hasStar = (row) => row.card.copies.some((copy) => copy.starred);
  const SORTS = {
    starred: (a, b) => Number(hasStar(b)) - Number(hasStar(a)),
    rarity: () => 0,
    name: () => 0,
    "price-desc": (a, b) => (b.price ?? -Infinity) - (a.price ?? -Infinity),
    "price-asc": (a, b) => (a.price ?? Infinity) - (b.price ?? Infinity),
  };

  const haystacks = new WeakMap();
  function haystackOf(card) {
    let value = haystacks.get(card);
    if (value === undefined) {
      value = normalize([card.title, ...card.tags.map((tag) => tag.name)].join(" "));
      haystacks.set(card, value);
    }
    return value;
  }

  function filterCards(cards, criteria, prices = {}) {
    const words = normalize(criteria.text).split(" ").filter(Boolean);
    const rarities = new Set(criteria.rarities ?? RARITIES);
    const include = new Set(criteria.includeTags ?? []);
    const exclude = new Set(criteria.excludeTags ?? []);
    const { minPrice, maxPrice } = criteria;
    const hasBound = Number.isFinite(minPrice) || Number.isFinite(maxPrice);

    const rows = [];
    for (const card of cards) {
      if (!rarities.has(card.rarity)) continue;
      const tagKeys = card.tags.map((tag) => tag.id || tag.name);
      if (include.size && !tagKeys.some((key) => include.has(key))) continue;
      if (tagKeys.some((key) => exclude.has(key))) continue;
      if (criteria.untagged && card.tags.length) continue;
      if (words.length) {
        const haystack = haystackOf(card);
        if (!words.every((word) => haystack.includes(word))) continue;
      }
      const price = priceFor(card, prices);
      if (hasBound) {
        if (price === null) continue;
        if (Number.isFinite(minPrice) && price < minPrice) continue;
        if (Number.isFinite(maxPrice) && price > maxPrice) continue;
      }
      rows.push({ card, price });
    }

    const byRarity = (a, b) => rank(a.card.rarity) - rank(b.card.rarity) || a.card.title.localeCompare(b.card.title, "fr");
    const byName = (a, b) => a.card.title.localeCompare(b.card.title, "fr");
    const primary = SORTS[criteria.sort] ?? SORTS.rarity;
    const fallback = criteria.sort === "name" ? byName : byRarity;
    return rows.sort((a, b) => primary(a, b) || fallback(a, b)).map((row) => row.card);
  }

  function paginate(items, page, size) {
    const pages = Math.max(1, Math.ceil(items.length / size));
    const current = Math.min(Math.max(1, page), pages);
    return { items: items.slice((current - 1) * size, current * size), page: current, pages, total: items.length };
  }

  function parseSummary(json) {
    const summary = json?.summary;
    if (!summary || typeof summary !== "object" || Array.isArray(summary)) return null;
    const averages = {};
    for (const rarity of RARITIES) {
      const raw = summary[rarity]?.average;
      const value = Number(raw);
      if (raw != null && raw !== "" && Number.isFinite(value) && value >= 0) averages[rarity] = value;
    }
    return averages;
  }

  function parseRetryAfter(header, now = Date.now()) {
    if (header == null || header === "") return null;
    const seconds = Number(header);
    const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
    return Number.isFinite(delay) ? Math.max(0, delay) : null;
  }

  function rateInfo(getHeader, now = Date.now()) {
    const first = (...names) => {
      for (const name of names) {
        const value = getHeader(name);
        if (value != null && value !== "") return value;
      }
      return null;
    };
    const num = (value) => (value == null || Number.isNaN(Number(value)) ? null : Number(value));

    let limit = num(first("ratelimit-limit", "x-ratelimit-limit", "x-rate-limit-limit"));
    let remaining = num(first("ratelimit-remaining", "x-ratelimit-remaining", "x-rate-limit-remaining"));
    let reset = num(first("ratelimit-reset", "x-ratelimit-reset", "x-rate-limit-reset"));

    const combined = first("ratelimit");
    if (combined) {
      const field = (key) => num(new RegExp(`${key}=(\\d+)`).exec(combined)?.[1]);
      limit = limit ?? field("limit");
      remaining = remaining ?? field("remaining");
      reset = reset ?? field("reset");
    }

    const resetMs = reset === null ? null : reset > 1e9 ? Math.max(0, reset * 1000 - now) : reset * 1000;
    return { limit, remaining, resetMs, retryAfterMs: parseRetryAfter(getHeader("retry-after"), now) };
  }

  function cardsFromPayload(pathname, json) {
    const found = [];
    const add = (id, title, rarity) => {
      if (id && title) found.push({ id, title, rarity: rarity ?? null });
    };
    const fromEntry = (entry, rarity) => add(entry?.card_id || entry?.card?.id, entry?.card?.wikipedia_title, rarity);

    if (pathname === "/api/my-collection") {
      for (const entry of json?.collection ?? []) fromEntry(entry, entry?.card?.rarity);
    } else if (pathname === "/api/marketplace") {
      for (const auction of json?.auctions ?? []) fromEntry(auction, auction?.snapshot_rarity || auction?.card?.rarity);
    } else if (pathname === "/api/cards") {
      for (const card of json?.cards ?? []) add(card?.id, card?.wikipedia_title, card?.rarity);
    } else if (pathname === "/api/packs/open") {
      for (const card of json?.cards ?? []) add(card?.id, card?.wikipedia_title, card?.rarity);
    } else if (pathname === "/api/trades") {
      for (const trade of json?.trades ?? []) {
        for (const item of trade?.items ?? []) fromEntry(item, item?.snapshot_rarity || item?.card?.rarity);
      }
    } else if (json?.auction) {
      fromEntry(json.auction, json.auction.snapshot_rarity || json.auction.card?.rarity);
    }

    return [...new Map(found.map((card) => [card.id, card])).values()];
  }

  function ownedFromPayload(pathname, json) {
    if (pathname !== "/api/my-collection") return [];
    return (json?.collection ?? [])
      .filter((entry) => entry?.id && (entry.card_id || entry.card?.id))
      .map((entry) => ({ cardId: entry.card_id || entry.card.id, ownedId: entry.id, starred: entry.starred === true }));
  }

  function pickCopy(copies) {
    return [...copies].sort((a, b) => Number(a.starred) - Number(b.starred))[0] ?? null;
  }

  function estimateTotals(cards, prices) {
    const totals = { value: 0, copies: 0, priced: 0, unpriced: 0, byRarity: {} };
    for (const card of cards) {
      const copies = card.copies.length;
      totals.copies += copies;
      const price = priceFor(card, prices);
      if (price === null) {
        totals.unpriced += 1;
        continue;
      }
      totals.priced += 1;
      totals.value += price * copies;
      totals.byRarity[card.rarity] = (totals.byRarity[card.rarity] ?? 0) + price * copies;
    }
    return totals;
  }

  const isAuction = (node) => node && typeof node === "object" && node.id && node.status && "base_amount" in node && node.card;

  function auctionsFromPayload(pathname, json) {
    if (!pathname.startsWith("/api/marketplace")) return [];
    const found = [];
    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 3) return;
      if (Array.isArray(node)) return node.forEach((item) => walk(item, depth + 1));
      if (isAuction(node)) return found.push(node);
      Object.values(node).forEach((value) => walk(value, depth + 1));
    };
    walk(json, 0);
    return found.map(toAuction);
  }

  function toAuction(auction) {
    return {
      id: auction.id,
      title: auction.card?.wikipedia_title ?? null,
      seller: auction.seller?.username ?? null,
      status: auction.status,
      base: auction.base_amount,
      current: auction.current_bid ?? null,
      minimum: null,
      shown: [auction.effective_bid, auction.base_amount, auction.current_bid].filter(Number.isFinite),
    };
  }

  function minimumFromMessage(message, floor) {
    const text = String(message ?? "").replace(/\d+(?:[.,]\d+)?\s*%/g, "");
    const numbers = [...text.matchAll(/\d+/g)].map((match) => Number(match[0])).filter((value) => value > (floor ?? 0));
    return numbers.length ? Math.min(...numbers) : null;
  }

  const BID_STEP = 0.1;

  function nextBid(auction) {
    const computed = auction.current === null ? auction.base : auction.current + Math.ceil(auction.current * BID_STEP);
    return Math.max(computed, auction.minimum ?? 0);
  }

  const pad = (value) => String(value).padStart(2, "0");

  function formatDuration(ms) {
    const total = Math.max(0, Math.round(ms / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
  }

  function progressLine({ done, total, failed = 0, startedAt, stamps, now, pauseMs = 0 }) {
    const percent = total ? Math.floor((done / total) * 100) : 100;
    const parts = [`Prix ${done}/${total} (${percent} %)`, `écoulé ${formatDuration(now - startedAt)}`];
    const spanMs = stamps.length > 1 ? now - stamps[0] : 0;
    const rate = spanMs > 0 ? ((stamps.length - 1) / spanMs) * 1000 : 0;
    parts.push(rate > 0 ? `reste ~${formatDuration(((total - done) / rate) * 1000)}` : "reste ?");
    if (rate > 0) parts.push(rate >= 1 ? `${rate.toFixed(1)} prix/s` : `${(60 * rate).toFixed(1)} prix/min`);
    if (pauseMs > 0) parts.push(`pause du site ${Math.ceil(pauseMs / 1000)} s`);
    if (failed) parts.push(`${failed} en échec`);
    return parts.join(" | ");
  }

  const SALE_DURATIONS = [
    [10, "10 min"],
    [30, "30 min"],
    [60, "1 h"],
    [180, "3 h"],
    [360, "6 h"],
    [720, "12 h"],
  ];

  function normalizeSale(raw) {
    const amount = Number(raw?.amount);
    const duration = Number(raw?.duration);
    return {
      amount: Number.isInteger(amount) && amount >= 1 ? amount : 10,
      duration: SALE_DURATIONS.some(([minutes]) => minutes === duration) ? duration : 10,
      visible: raw?.visible !== false,
    };
  }

  const AUTOMATION_BLOCK = /automatis|trop de requ/i;

  function rateLimited(status, message, retryAfterMs) {
    if (status === 429) return { retryAfterMs };
    if (status === 403 && AUTOMATION_BLOCK.test(message ?? "")) return { retryAfterMs: Math.max(retryAfterMs ?? 0, 30000) };
    return null;
  }

  const NO_TAG = "__none__";

  function tagFromLabel(label) {
    const text = String(label ?? "").replace(/\s+/g, " ").trim();
    if (!text || /^toutes les étiquettes$/i.test(text)) return null;
    if (/^sans étiquette$/i.test(text)) return NO_TAG;
    return text.replace(/^#/, "").replace(/\s*\(\d+\)$/, "").trim() || null;
  }

  const OWNERSHIP_ERROR = /poss[eé]dez pas/i;

  const api = {
    SALE_DURATIONS,
    NO_TAG,
    tagFromLabel,
    OWNERSHIP_ERROR,
    rateLimited,
    parseRetryAfter,
    rateInfo,
    ownedFromPayload,
    pickCopy,
    normalizeSale,
    RARITIES,
    DEFAULT_RARITIES,
    PAGE_SIZE,
    HOOKED_PATH,
    rank,
    normalize,
    mergeTags,
    mapEntry,
    mapTagOptions,
    mergeCollection,
    emptyCache,
    rarityPages,
    rarityStatus,
    tagStatus,
    applyRaritySync,
    applyTagSync,
    removeCopies,
    priceFor,
    selectForLoad,
    estimateTotals,
    auctionsFromPayload,
    toAuction,
    minimumFromMessage,
    nextBid,
    formatDuration,
    progressLine,
    filterCards,
    paginate,
    parseSummary,
    cardsFromPayload,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.WMT = root.WMT || {}).logic = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
