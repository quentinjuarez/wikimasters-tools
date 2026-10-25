const { test } = require("node:test");
const assert = require("node:assert");
const { createPrices, summarySource } = require("../src/prices.js");
const api = require("../src/api.js");
const logic = require("../src/logic.js");
const { createMemoryStore } = require("../src/store.js");

function setup({ source, concurrency, saved, savedRate, rateLimited } = {}) {
  let clock = 1000000;
  const store = createMemoryStore({
    prices: Object.entries(saved ?? {}).map(([id, entry]) => ({ id, ...entry })),
    kv: savedRate ? { rate: savedRate } : {},
  });
  const calls = [];
  const starts = [];
  let parallel = 0;
  let maxParallel = 0;
  const fetchSource = source ?? (async (id) => ({ R: Number(id.slice(1)) * 10 }));
  const prices = createPrices({
    store,
    fetchSource: async (id) => {
      calls.push(id);
      starts.push(clock);
      parallel += 1;
      maxParallel = Math.max(maxParallel, parallel);
      try {
        return await fetchSource(id);
      } finally {
        parallel -= 1;
      }
    },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    ...(concurrency ? { concurrency } : {}),
    ...(rateLimited ? { rateLimited } : {}),
    persistDelayMs: 0,
  });
  return { prices, calls, starts, store, advance: (ms) => (clock += ms), time: () => clock, maxParallel: () => maxParallel };
}

const card = (id, rarity = "R") => ({ id, rarity, title: id });
const limit429 = (retryAfterMs = null) => Object.assign(new Error("429"), { status: 429, retryAfterMs });

test("requests are sent one at a time", async () => {
  const { prices, maxParallel } = setup();
  await Promise.all(Array.from({ length: 10 }, (_, i) => prices.request(card(`c${i + 1}`), "low")));
  assert.strictEqual(maxParallel(), 1);
});

test("concurrent requests for one card cost a single call", async () => {
  const { prices, calls } = setup();
  const results = await Promise.all([prices.request(card("c1")), prices.request(card("c1")), prices.request(card("c1"))]);
  assert.deepStrictEqual(results, ["done", "done", "done"]);
  assert.deepStrictEqual(calls, ["c1"]);
  assert.strictEqual(prices.value("c1", "R"), 10);
});

test("a known price is served without any call", async () => {
  const { prices, calls } = setup({ saved: { c2: { averages: { R: 7 }, fetchedAt: 1 } } });
  await prices.load();
  assert.strictEqual(await prices.request(card("c2")), "done");
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(prices.value("c2", "R"), 7);
  assert.strictEqual(prices.value("c2", "L"), null);
  assert.strictEqual(prices.value("zz", "R"), undefined);
});

test("a failed refresh never erases the known value", async () => {
  const { prices } = setup({
    saved: { c3: { averages: { R: 30 }, fetchedAt: 1 } },
    source: async () => {
      throw Object.assign(new Error("boom"), { status: 404 });
    },
  });
  await prices.load();
  assert.strictEqual(await prices.refresh(card("c3")), "failed");
  assert.strictEqual(prices.value("c3", "R"), 30);
});

test("no delay at all on a fast server that never rate limits", async () => {
  const { prices, time } = setup();
  const start = time();
  await Promise.all(Array.from({ length: 20 }, (_, i) => prices.request(card(`c${i + 1}`), "low")));
  assert.strictEqual(time() - start, 0);
  assert.strictEqual(prices.status().gapMs, 0);
});

test("a 429 with Retry-After waits exactly that long, not a default", async () => {
  let limited = true;
  const { prices, time } = setup({
    source: async () => {
      if (limited) {
        limited = false;
        throw limit429(5000);
      }
      return { R: 1 };
    },
  });
  const start = time();
  assert.strictEqual(await prices.request(card("c1")), "done");
  assert.strictEqual(time() - start, 5000 + 250);
});

test("a 429 without header backs off 30 s, 60 s then 120 s", async () => {
  let hits = 0;
  const { prices, time } = setup({
    source: async () => {
      hits += 1;
      if (hits <= 3) throw limit429();
      return { R: 1 };
    },
  });
  const start = time();
  assert.strictEqual(await prices.request(card("c1")), "done");
  assert.strictEqual(time() - start, 30000 + 60000 + 120000);
});

test("after a 429 the cadence slows down, then eases back after a streak of successes", async () => {
  let limited = false;
  const { prices, starts } = setup({
    source: async () => {
      if (limited) {
        limited = false;
        throw limit429(1000);
      }
      return { R: 1 };
    },
  });
  limited = true;
  await prices.request(card("c1"), "low");
  assert.strictEqual(prices.status().gapMs, 400);

  await Promise.all(["c2", "c3", "c4"].map((id) => prices.request(card(id), "low")));
  const spacing = starts.slice(-3).map((t, i, all) => (i ? t - all[i - 1] : null)).slice(1);
  assert.ok(spacing.every((ms) => ms >= 400));

  await Promise.all(Array.from({ length: 40 }, (_, i) => prices.request(card(`d${i}`), "low")));
  assert.ok(prices.status().gapMs < 400);
});

test("the cadence converges just above the pace the server tolerates, by itself", async () => {
  let last = -Infinity;
  let limits = 0;
  const ctl = setup({
    source: async () => {
      const t = ctl.time();
      const tooFast = t - last < 600;
      last = t;
      ctl.advance(200);
      if (tooFast) {
        limits += 1;
        throw limit429(1000);
      }
      return { R: 1 };
    },
  });
  await Promise.all(Array.from({ length: 80 }, (_, i) => ctl.prices.request(card(`c${i}`), "low")));
  assert.ok(limits <= 6, `too many limits: ${limits}`);
  const tail = ctl.starts.slice(-10);
  assert.ok(tail.every((t, i) => !i || t - tail[i - 1] >= 600), "cadence still too fast at the end");
  assert.ok(ctl.prices.status().gapMs >= 300 && ctl.prices.status().gapMs <= 800, `gap ${ctl.prices.status().gapMs}`);
});

test("the learned cadence is saved and reused by the next session", async () => {
  let limited = true;
  const first = setup({
    source: async () => {
      if (limited) {
        limited = false;
        throw limit429(1000);
      }
      return { R: 1 };
    },
  });
  await first.prices.request(card("c1"), "low");
  const saved = await first.store.get("rate");
  assert.ok(saved.gap >= 400);

  const second = setup({ savedRate: saved });
  await second.prices.load();
  assert.strictEqual(second.prices.status().gapMs, saved.gap);
});

test("rate limit headers on normal responses spread the remaining budget and stop at zero", async () => {
  const { prices, starts, time } = setup();
  prices.observe({ limit: 60, remaining: 9, resetMs: 10000, retryAfterMs: null });
  assert.strictEqual(prices.status().gapMs, 1000);
  await Promise.all(["c1", "c2", "c3"].map((id) => prices.request(card(id), "low")));
  assert.deepStrictEqual([starts[1] - starts[0], starts[2] - starts[1]], [1000, 1000]);

  prices.observe({ limit: 60, remaining: 0, resetMs: 3000, retryAfterMs: null });
  const before = time();
  await prices.request(card("c4"), "low");
  assert.ok(time() - before >= 3250);

  prices.observe({ limit: null, remaining: null, resetMs: null, retryAfterMs: null });
  assert.strictEqual(prices.status().gapMs, 0);
});

test("the site's automation block (403) is a rate limit with a 30 s pause, not a failed card", async () => {
  let blocked = true;
  const { prices, time } = setup({
    rateLimited: (error) => logic.rateLimited(error.status, error.message, error.retryAfterMs),
    source: async () => {
      if (blocked) {
        blocked = false;
        throw Object.assign(new Error("Trop de requêtes automatisées"), { status: 403, retryAfterMs: null });
      }
      return { R: 5 };
    },
  });
  const start = time();
  assert.strictEqual(await prices.request(card("c1")), "done");
  assert.ok(time() - start >= 30000);
  assert.ok(time() - start < 60000);
  assert.strictEqual(prices.value("c1", "R"), 5);
});

test("visible cards (high) are served before bulk cards (low)", async () => {
  const { prices, calls } = setup();
  const bulk = ["c1", "c2", "c3"].map((id) => prices.request(card(id), "low"));
  const visible = prices.request(card("c9"), "high");
  await Promise.all([...bulk, visible]);
  assert.deepStrictEqual(calls, ["c1", "c9", "c2", "c3"]);
});

test("cancel drops queued bulk cards but not the running one", async () => {
  const { prices, calls } = setup();
  const results = ["c1", "c2", "c3"].map((id) => prices.request(card(id), "low"));
  prices.cancel((c) => c.id !== "c1");
  assert.deepStrictEqual(await Promise.all(results), ["done", "cancelled", "cancelled"]);
  assert.deepStrictEqual(calls, ["c1"]);
});

test("a card that failed is not hammered again right away", async () => {
  let n = 0;
  const { prices, calls, advance } = setup({
    source: async () => {
      n += 1;
      throw Object.assign(new Error("x"), { status: 404 });
    },
  });
  assert.strictEqual(await prices.request(card("c1")), "failed");
  assert.strictEqual(await prices.request(card("c1")), "failed");
  assert.strictEqual(n, 1);
  advance(6 * 60 * 1000);
  assert.strictEqual(await prices.request(card("c1")), "failed");
  assert.strictEqual(calls.length, 2);
});

test("prices are persisted and status reflects the cache", async () => {
  const { prices, store } = setup();
  await prices.request(card("c1"));
  await prices.flush();
  const records = await store.loadAll("prices");
  assert.deepStrictEqual(records.map((r) => [r.id, r.averages]), [["c1", { R: 10 }]]);
  assert.deepStrictEqual(prices.status(), { queued: 0, active: 0, cooldownMs: 0, gapMs: 0, manualGapMs: null, learnedGapMs: 0, cached: 1 });
  assert.strictEqual(prices.entry("c1").title, "c1");
});

test("the shared queue lists active then waiting cards, and a failed card can be retried", async () => {
  let fail = true;
  const { prices } = setup({
    source: async (id) => {
      if (id === "c1" && fail) throw Object.assign(new Error("x"), { status: 404 });
      return { R: 1 };
    },
  });
  const all = [prices.request(card("c1"), "low"), prices.request(card("c2"), "low")];
  assert.deepStrictEqual(prices.queue().map((q) => `${q.id}:${q.state}`), ["c1:active", "c2:queued"]);
  assert.strictEqual(prices.isPending("c2"), true);
  assert.deepStrictEqual(await Promise.all(all), ["failed", "done"]);
  assert.strictEqual(prices.hasFailed("c1"), true);
  assert.deepStrictEqual(prices.failedIds(), ["c1"]);
  fail = false;
  assert.strictEqual(await prices.refresh(card("c1"), "high"), "done");
  assert.strictEqual(prices.hasFailed("c1"), false);
});

test("summary source parses the endpoint, forwards every response and rejects invalid payloads", async () => {
  const seen = [];
  const good = summarySource({ fetchRetry: async (url, options) => (options.onResponse("r"), { summary: { SR: { average: 12 } } }) }, logic, (r) => seen.push(r));
  assert.deepStrictEqual(await good("a b"), { SR: 12 });
  assert.deepStrictEqual(seen, ["r"]);
  const bad = summarySource({ fetchRetry: async () => ({ summary: [] }) }, logic);
  await assert.rejects(bad("x"));
});

test("api retries 5xx, surfaces 429 with its Retry-After and exposes every response", async () => {
  let calls = 0;
  const res = (status, body, headers = {}) => ({ ok: status < 300, status, headers: { get: (k) => headers[k] ?? null }, json: async () => body });
  const flaky = async () => (++calls < 3 ? res(500, { error: "overflow" }) : res(200, { ok: true }));
  const seen = [];
  assert.deepStrictEqual(await api.fetchRetry("/x", { fetchImpl: flaky, backoffMs: 0, onResponse: (r) => seen.push(r.status) }), { ok: true });
  assert.strictEqual(calls, 3);
  assert.deepStrictEqual(seen, [500, 500, 200]);

  calls = 0;
  const limited = async () => (calls++, res(429, { error: "slow" }, { "Retry-After": "90" }));
  await assert.rejects(api.fetchRetry("/x", { fetchImpl: limited, backoffMs: 0 }), (e) => e.status === 429 && e.retryAfterMs === 90000);
  assert.strictEqual(calls, 1);

  const noHeader = async () => res(429, { error: "slow" });
  await assert.rejects(api.fetchRetry("/x", { fetchImpl: noHeader, backoffMs: 0 }), (e) => e.status === 429 && e.retryAfterMs === null);
});

test("a manual request jumps to the top of the pile, the latest click first, and promotes a card already waiting", async () => {
  const { prices, calls } = setup();
  const all = [
    prices.request(card("c1"), "low"),
    prices.request(card("c2"), "low"),
    prices.request(card("c3"), "low"),
    prices.request(card("v1"), "high"),
    prices.request(card("m1"), "high", { front: true, manual: true }),
    prices.request(card("c3"), "high", { front: true, manual: true }),
    prices.request(card("m2"), "high", { front: true, manual: true }),
  ];
  assert.deepStrictEqual(prices.queue().slice(1).map((q) => `${q.id}${q.manual ? "*" : ""}`), ["m2*", "c3*", "m1*", "v1", "c2"]);
  await Promise.all(all);
  assert.deepStrictEqual(calls, ["c1", "m2", "c3", "m1", "v1", "c2"]);
});

test("skipPause lifts the mandatory pause so the queue restarts at once", async () => {
  let clock = 1000000;
  let hits = 0;
  const prices = createPrices({
    store: createMemoryStore(),
    fetchSource: async () => {
      hits += 1;
      if (hits === 1) throw limit429(60000);
      return { R: 1 };
    },
    now: () => clock,
    sleep: () => new Promise(() => {}),
    persistDelayMs: 0,
  });
  const result = prices.request(card("c1"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(prices.status().cooldownMs > 0);
  assert.strictEqual(hits, 1);

  prices.skipPause();
  assert.strictEqual(await result, "done");
  assert.strictEqual(prices.status().cooldownMs, 0);
  assert.strictEqual(hits, 2);
  assert.strictEqual(clock, 1000000);
});

test("the manual interval overrides the learned cadence, is respected by every request and is saved", async () => {
  const first = setup({
    source: async () => ({ R: 1 }),
  });
  first.prices.setMinInterval(1500);
  assert.strictEqual(first.prices.status().gapMs, 1500);
  await Promise.all(["c1", "c2", "c3"].map((id) => first.prices.request(card(id), "low")));
  assert.deepStrictEqual([first.starts[1] - first.starts[0], first.starts[2] - first.starts[1]], [1500, 1500]);
  assert.deepStrictEqual(await first.store.get("rate-setting"), { manual: 1500 });

  const second = setup({ savedRate: { gap: 4000, floor: 0 } });
  second.store.set("rate-setting", { manual: 200 });
  await second.prices.load();
  assert.strictEqual(second.prices.status().learnedGapMs, 4000);
  assert.strictEqual(second.prices.status().gapMs, 200);
  second.prices.setMinInterval(null);
  assert.strictEqual(second.prices.status().gapMs, 4000);
});
