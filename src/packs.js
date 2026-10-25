(function (root) {
  const label = (button) => button.textContent.trim();
  const isNav = (button) => /\bw-12\b/.test(button.className) && /\bh-12\b/.test(button.className);

  function targetFor(key, doc) {
    const buttons = [...doc.querySelectorAll("main button")].filter((button) => !button.disabled);
    if (key === "ArrowUp") return buttons.find((button) => label(button) === "Ouvrir");
    if (key === "ArrowDown") return buttons.find((button) => /^(Continuer|Encore)\b/.test(label(button)));
    const nav = [...doc.querySelectorAll("main button")].filter(isNav);
    const target = key === "ArrowLeft" ? nav[0] : key === "ArrowRight" ? nav[1] : undefined;
    return target && !target.disabled ? target : undefined;
  }

  const typing = (node) => node?.closest?.("input, textarea, select, [contenteditable]");

  function onKeyDown(event, doc = document, path = location.pathname) {
    if (path !== "/pulls" || event.repeat || event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || typing(event.target)) return;
    const target = targetFor(event.key, doc);
    if (!target) return;
    event.preventDefault();
    target.click();
  }

  const api = { targetFor, onKeyDown };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    (root.WMT = root.WMT || {}).packs = api;
    document.addEventListener("keydown", (event) => onKeyDown(event));
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
