(function (root) {
  const wmt = root.WMT;
  const { logic, ui } = wmt;
  const DONE_RESET_MS = 4000;
  const FAIL_RESET_MS = 12000;
  let settings = logic.normalizeSale(null);
  let busy = false;
  let strip = null;

  const durationLabel = () => logic.SALE_DURATIONS.find(([minutes]) => minutes === settings.duration)[1];
  const idleLabel = () => `Vendre ${ui.format(settings.amount)} W`;
  const idleHint = () => `Mettre en vente à ${settings.amount} W pendant ${durationLabel()}`;

  const SITE_CARD = 'div[class*="rounded-2xl"][class*="overflow-hidden"]';
  const MODAL_WAIT_MS = 120000;
  const HUMAN_CHECK = "human_verification_required";
  const visible = (node) => node?.isConnected;
  const byText = (pattern) => [...document.querySelectorAll("button")].find((node) => pattern.test(node.textContent));

  async function fillAuctionModal(card) {
    card.click();
    const open = await ui.waitFor(() => byText(/Mettre aux enchères/));
    if (!open) return null;
    open.click();
    const launch = await ui.waitFor(() => byText(/Lancer l.enchère/));
    if (!launch) return null;
    let modal = launch;
    while (modal && !modal.querySelector("input")) modal = modal.parentElement;
    const input = modal.querySelector("input");
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, String(settings.amount));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    [...modal.querySelectorAll("button")].find((node) => node.textContent.trim() === durationLabel())?.click();
    return launch;
  }

  async function runModal(card, button) {
    const launch = await fillAuctionModal(card);
    if (!launch) return null;
    setState(button, "busy", "Clique Lancer", "Vérification anti-bot : clique sur Lancer l'enchère");
    const clicked = await new Promise((resolve) => {
      launch.addEventListener("click", () => resolve(true), { once: true });
      ui.waitFor(() => !visible(launch), MODAL_WAIT_MS).then(() => resolve(false));
    });
    if (!clicked) return "cancelled";
    await ui.waitFor(() => !visible(launch), MODAL_WAIT_MS);
    return visible(launch) ? "cancelled" : "sold";
  }

  async function sellViaInterface(button, copy, cardId) {
    const card = button.closest(SITE_CARD);
    const title = wmt.collection.cache().cards.find((entry) => entry.cardId === cardId)?.title;
    const outcome = card
      ? await runModal(card, button)
      : title
        ? await wmt.filters.withSiteCard(title, (found) => runModal(found, button))
        : null;
    if (outcome === "sold") {
      wmt.registry.dropOwned(cardId, copy.id);
      wmt.collection.dropCopies([copy.id]);
      setState(button, "done", "En vente", idleHint());
      return copy.id;
    }
    if (outcome === "cancelled") {
      setState(button, null);
      return null;
    }
    return fail(button, "Vérification requise : carte introuvable sur la page, mets-la aux enchères à la main");
  }

  const applyVisibility = () => document.body.classList.toggle("wmt-hide-sell", !settings.visible);

  function setState(button, state, text, title) {
    if (state) button.dataset.state = state;
    else delete button.dataset.state;
    button.textContent = text ?? idleLabel();
    button.title = title ?? idleHint();
    button.disabled = state === "busy" || state === "done";
  }

  function refreshButtons() {
    for (const button of document.querySelectorAll(".wmt-sell:not([data-state])")) setState(button, null);
  }

  function fail(button, message) {
    setState(button, "error", "Échec", message);
    setTimeout(() => button.dataset.state === "error" && setState(button, null), FAIL_RESET_MS);
    return null;
  }

  async function sellById(cardId, button) {
    if (busy) return null;
    const copy = logic.pickCopy(wmt.registry.owned(cardId));
    if (!copy) return fail(button, "Exemplaire inconnu, recharge la page");

    if (copy.starred && button.dataset.state !== "confirm") {
      setState(button, "confirm", "Favori : confirmer", "Cet exemplaire est en favori");
      setTimeout(() => button.dataset.state === "confirm" && setState(button, null), DONE_RESET_MS);
      return null;
    }

    busy = true;
    setState(button, "busy", "Mise en vente");
    try {
      await wmt.api.postJson("/api/marketplace", {
        card_id: copy.id,
        base_amount: settings.amount,
        duration_minutes: settings.duration,
      });
      wmt.registry.dropOwned(cardId, copy.id);
      wmt.collection.dropCopies([copy.id]);
      setState(button, "done", "En vente", idleHint());
      return copy.id;
    } catch (error) {
      if (error.status === 403 && error.code === HUMAN_CHECK) {
        return sellViaInterface(button, copy, cardId);
      }
      if (logic.OWNERSHIP_ERROR.test(error.message)) wmt.registry.dropOwned(cardId, copy.id);
      return fail(button, error.message);
    } finally {
      busy = false;
    }
  }

  function createButton(cardId, onSold) {
    const button = ui.button("", "wmt-sell");
    setState(button, null);
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (await sellById(cardId(), button)) onSold?.();
    });
    return button;
  }

  function decorate(card) {
    card.classList.add("wmt-collection");
    const holder = card.querySelector(".mt-auto");
    if (!holder || holder.querySelector(".wmt-sell")) return;
    holder.appendChild(
      createButton(
        () => wmt.badges.stateOf(card)?.id,
        () => card.classList.add("wmt-sold"),
      ),
    );
  }

  function buildStrip() {
    const node = ui.el("div", "card-frame wmt-strip");
    const amount = ui.el("input", "wmt-input wmt-amount");
    amount.type = "number";
    amount.min = "1";
    amount.step = "1";
    amount.value = String(settings.amount);
    amount.setAttribute("aria-label", "Mise de départ");

    const duration = ui.el("select", "wmt-input wmt-duration");
    duration.setAttribute("aria-label", "Durée");
    for (const [minutes, text] of logic.SALE_DURATIONS) {
      const option = ui.el("option", "", text);
      option.value = String(minutes);
      duration.append(option);
    }
    duration.value = String(settings.duration);
    const visible = ui.toggle("Boutons de vente", settings.visible);

    function change() {
      const value = Number(amount.value);
      const valid = Number.isInteger(value) && value >= 1;
      amount.toggleAttribute("aria-invalid", !valid);
      settings = logic.normalizeSale({
        amount: valid ? value : settings.amount,
        duration: Number(duration.value),
        visible: visible.box.checked,
      });
      wmt.store.set("sale", settings);
      applyVisibility();
      refreshButtons();
    }
    amount.addEventListener("input", change);
    duration.addEventListener("change", change);
    visible.box.addEventListener("change", change);
    const remember = ui.toggle("Mémoriser mes filtres", wmt.prefs.get("rememberFilters"));
    remember.box.addEventListener("change", () => wmt.prefs.set("rememberFilters", remember.box.checked));

    node.append(
      ui.el("span", "wmt-strip-label", "Vente"),
      amount,
      ui.el("span", "", "W"),
      duration,
      visible.label,
      remember.label,
      ui.el("span", "wmt-muted", "Chaque carte a un bouton qui la met en vente avec ces réglages."),
    );
    return node;
  }

  function syncPage(onCollection) {
    if (!onCollection) {
      strip?.remove();
      strip = null;
      return;
    }
    applyVisibility();
    if (strip?.isConnected) return;
    const row = document.querySelector("div.gap-3.animate-fade-in-up h1")?.parentElement;
    if (!row) return;
    strip = buildStrip();
    row.insertAdjacentElement("afterend", strip);
  }

  async function load() {
    settings = logic.normalizeSale(await wmt.store.get("sale"));
  }

  wmt.sale = { load, decorate, syncPage, createButton, isVisible: () => settings.visible };
})(window);
