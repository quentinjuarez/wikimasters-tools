(function (root) {
  const FAILED_RETRY_MS = 5 * 60 * 1000;
  const DEFAULT_PAUSE_MS = 30000;
  const MAX_DEFAULT_PAUSE_MS = 300000;
  const MAX_HEADER_PAUSE_MS = 600000;
  const SAFETY_MS = 250;
  const MIN_LEARNED_GAP_MS = 400;
  const MAX_LEARNED_GAP_MS = 10000;
  const MIN_TRIGGER_MS = 100;
  const EASE_AFTER = 25;
  const EASE_FACTOR = 0.85;
  const FLOOR_MARGIN = 1.2;
  const FLOOR_DECAY = 0.9;
  const RECENT_STARTS = 10;

  function createPrices({
    store,
    fetchSource,
    rateLimited = (error) => (error?.status === 429 ? { retryAfterMs: error.retryAfterMs ?? null } : null),
    now = Date.now,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    concurrency = 1,
    persistDelayMs = 1500,
  }) {
    let data = {};
    const dirty = new Set();
    const queues = { high: [], low: [] };
    const pending = new Map();
    const running = new Set();
    const failed = new Map();
    const listeners = new Set();
    let idleWaiters = [];
    let streak = 0;
    let strikes = 0;
    let cooldownUntil = 0;
    let lastStart = -Infinity;
    let learnedGap = 0;
    let floorGap = 0;
    let headerGap = 0;
    let manualGap = null;
    let recentStarts = [];
    let waitScheduled = false;
    let persistTimer = null;

    const queued = () => queues.high.length + queues.low.length;
    const notify = (id) => listeners.forEach((listener) => listener(id));

    function checkIdle() {
      if (running.size || queued()) return;
      const waiters = idleWaiters;
      idleWaiters = [];
      waiters.forEach((resolve) => resolve());
    }

    async function writeDirty() {
      if (!dirty.size) return;
      const records = [...dirty].map((id) => ({ id, ...data[id] }));
      dirty.clear();
      await store.putMany("prices", records);
    }

    function persistSoon() {
      clearTimeout(persistTimer);
      persistTimer = setTimeout(writeDirty, persistDelayMs);
    }

    async function flush() {
      clearTimeout(persistTimer);
      await writeDirty();
    }

    function finish(entry, result) {
      pending.delete(entry.card.id);
      entry.resolve(result);
    }

    const gap = () => Math.max(manualGap ?? learnedGap, headerGap);
    const nextAllowed = () => Math.max(cooldownUntil, lastStart + gap());

    const saveRate = () => store.set("rate", { gap: learnedGap, floor: floorGap });

    function onSuccess() {
      strikes = 0;
      streak += 1;
      if (streak < EASE_AFTER || learnedGap === 0) return;
      streak = 0;
      floorGap *= FLOOR_DECAY;
      const target = Math.max(learnedGap * EASE_FACTOR, floorGap * FLOOR_MARGIN);
      learnedGap = target < MIN_TRIGGER_MS ? 0 : target;
      saveRate();
    }

    function triggerInterval() {
      if (recentStarts.length < 2) return MIN_TRIGGER_MS;
      const span = recentStarts[recentStarts.length - 1] - recentStarts[0];
      return Math.max(MIN_TRIGGER_MS, span / (recentStarts.length - 1));
    }

    function onRateLimit(info) {
      strikes += 1;
      streak = 0;
      const pause =
        info.retryAfterMs != null
          ? Math.min(MAX_HEADER_PAUSE_MS, Math.max(1000, info.retryAfterMs)) + SAFETY_MS
          : Math.min(MAX_DEFAULT_PAUSE_MS, DEFAULT_PAUSE_MS * 2 ** (strikes - 1));
      cooldownUntil = Math.max(cooldownUntil, now() + pause);
      const trigger = triggerInterval();
      floorGap = Math.max(floorGap, trigger);
      learnedGap = Math.min(MAX_LEARNED_GAP_MS, Math.max(trigger * 1.5, learnedGap * 1.5, MIN_LEARNED_GAP_MS));
      saveRate();
    }

    function observe(info) {
      if (info.remaining === null || info.resetMs === null) {
        headerGap = 0;
        return;
      }
      if (info.remaining <= 0) {
        cooldownUntil = Math.max(cooldownUntil, now() + info.resetMs + SAFETY_MS);
        headerGap = 0;
        return;
      }
      headerGap = Math.ceil(info.resetMs / (info.remaining + 1));
    }

    async function start(entry) {
      entry.running = true;
      running.add(entry);
      const { id, title, rarity } = entry.card;
      try {
        const averages = await fetchSource(id);
        data[id] = { averages, fetchedAt: now(), title: title ?? data[id]?.title, rarity: rarity ?? data[id]?.rarity };
        dirty.add(id);
        failed.delete(id);
        onSuccess();
        persistSoon();
        notify(id);
        finish(entry, "done");
      } catch (error) {
        const limited = rateLimited(error);
        if (limited) {
          onRateLimit(limited);
          entry.running = false;
          queues[entry.priority].unshift(entry);
        } else {
          failed.set(id, now());
          finish(entry, "failed");
          notify(id);
        }
      }
      running.delete(entry);
      pump();
    }

    function pump() {
      while (running.size < concurrency && now() >= nextAllowed()) {
        const entry = queues.high.shift() ?? queues.low.shift();
        if (!entry) break;
        lastStart = now();
        recentStarts = [...recentStarts, lastStart].slice(-RECENT_STARTS);
        start(entry);
      }
      if (queued() && running.size < concurrency && now() < nextAllowed() && !waitScheduled) {
        waitScheduled = true;
        sleep(nextAllowed() - now()).then(() => {
          waitScheduled = false;
          pump();
        });
      }
      checkIdle();
    }

    function enqueue(card, priority, force, { front = false, manual = false } = {}) {
      if (data[card.id] && !force) return Promise.resolve("done");

      const existing = pending.get(card.id);
      if (existing) {
        if (!existing.running && (priority === "high" || front)) {
          queues.low = queues.low.filter((entry) => entry !== existing);
          queues.high = queues.high.filter((entry) => entry !== existing);
          existing.priority = "high";
          existing.manual ||= manual;
          queues.high[front ? "unshift" : "push"](existing);
          notify(card.id);
          pump();
        }
        return existing.promise;
      }

      if (!force && failed.has(card.id) && now() - failed.get(card.id) < FAILED_RETRY_MS) {
        return Promise.resolve("failed");
      }

      let resolve;
      const promise = new Promise((done) => {
        resolve = done;
      });
      const entry = { card, priority, resolve, promise, running: false, manual };
      pending.set(card.id, entry);
      queues[priority][front ? "unshift" : "push"](entry);
      notify(card.id);
      pump();
      return promise;
    }

    return {
      async load() {
        data = Object.fromEntries((await store.loadAll("prices")).map(({ id, ...entry }) => [id, entry]));
        const rate = await store.get("rate");
        learnedGap = Number(rate?.gap) || 0;
        floorGap = Number(rate?.floor) || 0;
        const setting = await store.get("rate-setting");
        manualGap = Number.isFinite(setting?.manual) ? Math.max(0, setting.manual) : null;
        notify(null);
      },
      all: () => data,
      entry: (id) => data[id],
      value(id, rarity) {
        const entry = data[id];
        if (!entry) return undefined;
        const average = entry.averages?.[rarity];
        return Number.isFinite(average) ? average : null;
      },
      isPending: (id) => pending.has(id),
      hasFailed: (id) => failed.has(id) && now() - failed.get(id) < FAILED_RETRY_MS,
      failedIds: () => [...failed.keys()].filter((id) => now() - failed.get(id) < FAILED_RETRY_MS),
      request: (card, priority = "high", options) => enqueue(card, priority, false, options),
      refresh: (card, priority = "low", options) => enqueue(card, priority, true, options),
      setMinInterval(ms) {
        manualGap = Number.isFinite(ms) ? Math.max(0, ms) : null;
        store.set("rate-setting", { manual: manualGap });
        notify(null);
        pump();
      },
      skipPause() {
        cooldownUntil = 0;
        strikes = 0;
        lastStart = -Infinity;
        waitScheduled = false;
        notify(null);
        pump();
      },
      cancel(predicate) {
        for (const name of ["high", "low"]) {
          queues[name] = queues[name].filter((entry) => {
            if (!predicate(entry.card)) return true;
            finish(entry, "cancelled");
            return false;
          });
        }
        notify(null);
        checkIdle();
      },
      queue: () => [
        ...[...running].map((entry) => ({ ...entry.card, state: "active", priority: entry.priority, manual: entry.manual })),
        ...queues.high.map((entry) => ({ ...entry.card, state: "queued", priority: "high", manual: entry.manual })),
        ...queues.low.map((entry) => ({ ...entry.card, state: "queued", priority: "low", manual: entry.manual })),
      ],
      observe,
      status: () => ({
        queued: queued(),
        active: running.size,
        cooldownMs: Math.max(0, cooldownUntil - now()),
        gapMs: gap(),
        manualGapMs: manualGap,
        learnedGapMs: learnedGap,
        cached: Object.keys(data).length,
      }),
      onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      idle: () => (running.size || queued() ? new Promise((resolve) => idleWaiters.push(resolve)) : Promise.resolve()),
      flush,
    };
  }

  function summarySource(api, logic, onResponse) {
    return async (id) => {
      const json = await api.fetchRetry(`/api/marketplace/cards/${encodeURIComponent(id)}/sales?scope=summary`, { onResponse });
      const averages = logic.parseSummary(json);
      if (!averages) throw new Error("Résumé des ventes invalide");
      return averages;
    };
  }

  const exported = { createPrices, summarySource };
  if (typeof module !== "undefined" && module.exports) module.exports = exported;
  else {
    const wmt = (root.WMT = root.WMT || {});
    wmt.createPrices = createPrices;
    wmt.prices = createPrices({
      store: wmt.store,
      fetchSource: summarySource(wmt.api, wmt.logic, (response) =>
        wmt.prices.observe(wmt.logic.rateInfo((name) => response.headers.get(name))),
      ),
      rateLimited: (error) => wmt.logic.rateLimited(error?.status, error?.message, error?.retryAfterMs),
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
