(function (root) {
  const format = (value) =>
    Number.isFinite(value) ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(value) : "?";

  const plural = (count, word) => `${count} ${word}${count > 1 && !/[sx]$/.test(word) ? "s" : ""}`;

  function age(timestamp, now = Date.now()) {
    const minutes = Math.max(1, Math.round((now - timestamp) / 60000));
    if (minutes < 60) return `${minutes} min`;
    if (minutes < 1440) return `${Math.round(minutes / 60)} h`;
    return `${Math.round(minutes / 1440)} j`;
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, className = "") {
    const node = el("button", `wmt-btn ${className}`.trim(), label);
    node.type = "button";
    return node;
  }

  function progress() {
    const node = el("div", "wmt-progress");
    const fill = el("div", "wmt-progress-fill");
    node.append(fill);
    return {
      el: node,
      set(ratio) {
        fill.style.width = `${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%`;
      },
    };
  }

  function toggle(label, checked) {
    const box = el("input");
    box.type = "checkbox";
    box.checked = checked;
    box.className = "wmt-switch-input";
    const wrap = el("label", "wmt-switch");
    wrap.append(box, el("span", "wmt-switch-track"), el("span", "", label));
    return { box, label: wrap };
  }

  function search(placeholder) {
    const input = el("input", "wmt-input");
    input.type = "search";
    input.placeholder = placeholder;
    input.setAttribute("aria-label", placeholder);
    return input;
  }

  async function waitFor(find, ms = 4000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const found = find();
      if (found) return found;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return null;
  }

  const api = { toggle, waitFor, format, plural, age, el, button, progress, search };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else (root.WMT = root.WMT || {}).ui = api;
})(typeof globalThis !== "undefined" ? globalThis : window);
