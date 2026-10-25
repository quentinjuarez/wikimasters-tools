(function (root) {
  const logic = typeof require !== "undefined" ? require("./logic.js") : root.WMT.logic;

  class HttpError extends Error {
    constructor(status, message, retryAfterMs, code) {
      super(message || `HTTP ${status}`);
      this.status = status;
      this.code = code;
      this.retryAfterMs = retryAfterMs;
    }
  }

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function fetchJson(url, { timeoutMs = 15000, fetchImpl = fetch, method, body, onResponse } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        credentials: "include",
        headers: body === undefined ? { accept: "*/*" } : { accept: "*/*", "content-type": "application/json" },
        signal: controller.signal,
        ...(method ? { method } : {}),
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      onResponse?.(response);
      if (!response.ok) {
        let message = "";
        let code;
        try {
          const json = await response.json();
          message = json?.error || json?.message || "";
          code = json?.code;
        } catch {
          message = "";
        }
        throw new HttpError(response.status, message, logic.parseRetryAfter(response.headers.get("Retry-After")), code);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchRetry(url, options = {}, attempts = 3) {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await fetchJson(url, options);
      } catch (error) {
        const retryable = error.status === undefined || (error.status >= 500 && error.status <= 599);
        if (!retryable || attempt >= attempts) throw error;
        await sleep(options.backoffMs ?? 300 * attempt);
      }
    }
  }

  const postJson = (url, body, options = {}) => fetchJson(url, { ...options, method: "POST", body });

  const api = { HttpError, sleep, fetchJson, fetchRetry, postJson };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.WMT = root.WMT || {}).api = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
