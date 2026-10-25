(() => {
  const HOOKED = /^\/api\/(my-collection|cards|marketplace(\/[\w-]+){0,2}|packs\/open|trades)$/i;
  const originalFetch = window.fetch;

  function hookedPath(input) {
    try {
      const url = new URL(typeof input === "string" ? input : input.url, location.origin);
      return url.origin === location.origin && HOOKED.test(url.pathname) ? url.pathname : null;
    } catch {
      return null;
    }
  }

  window.fetch = function (...args) {
    const promise = originalFetch.apply(this, args);
    const path = hookedPath(args[0]);
    if (path) {
      promise
        .then((response) => {
          if (!response.ok) return;
          response
            .clone()
            .json()
            .then((json) => window.postMessage({ source: "wmt-hook", path, json }, location.origin))
            .catch(() => {});
        })
        .catch(() => {});
    }
    return promise;
  };
})();
