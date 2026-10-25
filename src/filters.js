(function (root) {
  const wmt = root.WMT;
  const { logic } = wmt;
  const BLOCK = "div.space-y-3.animate-fade-in-up";
  const SEARCH = 'input[placeholder^="Rechercher"]';
  const TAG_BUTTON = 'button[aria-label="Filtrer par étiquette"]';
  const SORT_BUTTON = 'button[aria-label="Trier la collection"]';
  const RARITY = /^(L|UR|SR|R|PC|C)$/;
  const CAPTURE_DELAY_MS = 300;
  const SETTLE_MS = 150;
  const OPTION_WAIT_MS = 3000;
  const CARD = 'div[class*="rounded-2xl"][class*="overflow-hidden"]';
  const CARD_WAIT_MS = 15000;
  const PRICE_SORT = "Prix décroissant";

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const restored = new WeakSet();
  let saved = null;
  let restoring = false;
  let muted = false;
  let captureTimer = null;
  let notifyTimer = null;
  let priceSortOn = false;
  let lastBlock = null;
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());

  const findBlock = () => document.querySelector(SEARCH)?.closest(BLOCK) ?? null;
  const rarityChips = (block) => [...block.querySelectorAll("button")].filter((button) => RARITY.test(button.textContent.trim()));
  const isOn = (chip) => !/\bopacity-50\b/.test(chip.className);

  function readUi(block) {
    return {
      text: block.querySelector(SEARCH)?.value ?? "",
      tag: logic.tagFromLabel(block.querySelector(TAG_BUTTON)?.textContent),
      sort: priceSortOn ? PRICE_SORT : block.querySelector(SORT_BUTTON)?.textContent.trim() || null,
      rarities: rarityChips(block).filter(isOn).map((chip) => chip.textContent.trim()),
    };
  }

  const ready = (block) => Boolean(block.querySelector(SEARCH) && block.querySelector(TAG_BUTTON) && block.querySelector(SORT_BUTTON) && rarityChips(block).length);

  function setLabelText(root, text) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeValue.trim()) {
        node.nodeValue = text;
        return;
      }
    }
    root.append(document.createTextNode(text));
  }

  const sortTrigger = () => findBlock()?.querySelector(SORT_BUTTON) ?? null;
  const sortList = () => {
    const trigger = sortTrigger();
    return trigger ? document.getElementById(trigger.getAttribute("aria-controls") ?? "") : null;
  };

  function choosePriceSort(on) {
    priceSortOn = on;
    const trigger = sortTrigger();
    if (on && trigger) {
      setLabelText(trigger, PRICE_SORT);
      if (trigger.getAttribute("aria-expanded") === "true") trigger.click();
    }
    sortList()?.querySelector("[data-wmt-option]")?.setAttribute("aria-selected", String(on));
    clearTimeout(captureTimer);
    captureTimer = setTimeout(capture, CAPTURE_DELAY_MS);
    notify();
  }

  function injectPriceOption() {
    const list = sortList();
    if (!list || list.querySelector("[data-wmt-option]")) return;
    const last = [...list.querySelectorAll('[role="option"]')].at(-1);
    if (!last) return;
    const holder = last.closest("li") && list.contains(last.closest("li")) ? last.closest("li") : last;
    const clone = holder.cloneNode(true);
    const option = clone.matches('[role="option"]') ? clone : clone.querySelector('[role="option"]');
    setLabelText(option, PRICE_SORT);
    option.dataset.wmtOption = "price";
    option.setAttribute("aria-selected", String(priceSortOn));
    option.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      choosePriceSort(true);
    });
    holder.after(clone);
  }

  function keepPriceLabel() {
    const trigger = sortTrigger();
    if (priceSortOn && trigger && trigger.textContent.trim() !== PRICE_SORT) setLabelText(trigger, PRICE_SORT);
  }

  async function pick(trigger, matches) {
    trigger.click();
    const deadline = Date.now() + OPTION_WAIT_MS;
    while (Date.now() < deadline) {
      injectPriceOption();
      const list = document.getElementById(trigger.getAttribute("aria-controls") ?? "") ?? document;
      const option = [...list.querySelectorAll('[role="option"]')].find((node) => matches(node.textContent));
      if (option) {
        option.click();
        return true;
      }
      await sleep(80);
    }
    if (trigger.getAttribute("aria-expanded") === "true") trigger.click();
    return false;
  }

  function setText(input, value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function withSiteCard(title, action) {
    const input = findBlock()?.querySelector(SEARCH);
    if (!input) return null;
    const wanted = wmt.logic.normalize(title);
    const previous = input.value;
    muted = true;
    try {
      setText(input, title);
      const card = await wmt.ui.waitFor(() =>
        [...document.querySelectorAll(CARD)].find((node) => wmt.logic.normalize(node.querySelector("h3")?.textContent ?? "") === wanted),
        CARD_WAIT_MS,
      );
      return card ? await action(card) : null;
    } finally {
      setText(input, previous);
      muted = false;
    }
  }

  async function apply(block, wanted) {
    const current = readUi(block);

    const desired = new Set(wanted.rarities);
    for (const chip of rarityChips(block)) {
      if (isOn(chip) !== desired.has(chip.textContent.trim())) {
        chip.click();
        await sleep(SETTLE_MS);
      }
    }

    if (wanted.text !== current.text) {
      setText(block.querySelector(SEARCH), wanted.text);
      await sleep(SETTLE_MS);
    }

    if (wanted.tag !== current.tag) {
      const target = wanted.tag ?? null;
      await pick(block.querySelector(TAG_BUTTON), (label) => logic.tagFromLabel(label) === target || (target === null && /^toutes/i.test(label.trim())));
      await sleep(SETTLE_MS);
    }

    if (wanted.sort && wanted.sort !== current.sort) {
      await pick(block.querySelector(SORT_BUTTON), (label) => label.trim() === wanted.sort);
      await sleep(SETTLE_MS);
    }
  }

  async function restore(block) {
    restoring = true;
    try {
      await apply(block, saved);
    } finally {
      restoring = false;
      notify();
    }
  }

  async function capture() {
    captureTimer = null;
    const block = findBlock();
    if (!block || !ready(block) || restoring || !wmt.prefs.get("rememberFilters")) return;
    saved = readUi(block);
    await wmt.store.set("filters", saved);
  }

  function scheduleCapture(event) {
    if (muted) return;
    if (!event.target.closest?.(`${BLOCK}, [role="option"]`)) return;
    const option = event.target.closest('[role="option"]');
    if (option && !option.dataset.wmtOption && sortList()?.contains(option)) priceSortOn = false;
    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(notify, 200);
    if (restoring) return;
    clearTimeout(captureTimer);
    captureTimer = setTimeout(capture, CAPTURE_DELAY_MS);
  }

  function syncPage(onCollection) {
    if (!onCollection) return;
    const block = findBlock();
    if (block !== lastBlock) {
      lastBlock = block;
      priceSortOn = false;
    }
    injectPriceOption();
    keepPriceLabel();
    if (!block || !ready(block) || restored.has(block)) return;
    restored.add(block);
    if (saved && wmt.prefs.get("rememberFilters")) restore(block);
  }

  let syncTimer = null;
  function scheduleSync() {
    if (syncTimer) return;
    syncTimer = setTimeout(() => {
      syncTimer = null;
      syncPage(location.pathname.startsWith("/collection"));
    }, 200);
  }

  async function load() {
    saved = (await wmt.store.get("filters")) ?? null;
    document.addEventListener("input", scheduleCapture, true);
    document.addEventListener("click", scheduleCapture, true);
    new MutationObserver(scheduleSync).observe(document.body, { childList: true, subtree: true });
    scheduleSync();
  }

  wmt.filters = {
    PRICE_SORT,
    withSiteCard,
    load,
    syncPage,
    block: findBlock,
    read() {
      const block = findBlock();
      return block && ready(block) ? readUi(block) : null;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})(window);
