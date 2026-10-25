(function (root) {
  const wmt = root.WMT;
  const { logic, ui } = wmt;
  const RESET_MS = 12000;
  const MAX_AUCTIONS = 600;
  const MAX_CLIMB = 6;
  const HUMAN_CHECK = "human_verification_required";
  const BALANCE_ERROR = /solde|insuffisant|balance|wikibidous/i;
  let auctions = [];
  let busy = false;

  function add(list) {
    if (!list.length) return;
    const ids = new Set(list.map((auction) => auction.id));
    auctions = [...list, ...auctions.filter((auction) => !ids.has(auction.id))].slice(0, MAX_AUCTIONS);
  }

  function tileOf(card) {
    let tile = card;
    let node = card.parentElement;
    for (let depth = 0; depth < MAX_CLIMB && node; depth += 1, node = node.parentElement) {
      if (node.querySelectorAll("h3").length > 1) break;
      tile = node;
    }
    return tile;
  }

  function match(tile, title) {
    const text = tile.textContent;
    const seller = text.match(/Vendu par\s*([^\n]+?)\s*$/)?.[1]?.trim();
    const shown = Number(text.match(/(?:départ|actuelle|mise)\s*(\d+)/i)?.[1]);
    const found = auctions.filter((auction) => auction.title === title && (!seller || auction.seller === seller));
    return found.find((auction) => auction.shown.includes(shown)) ?? found[0] ?? null;
  }

  const ended = (auction) => auction.status !== "active";
  const idleLabel = (auction) => {
    if (ended(auction)) return "Terminée";
    return auction.leading ? `Tu mènes à ${auction.current} W` : `Enchérir ${ui.format(logic.nextBid(auction))} W`;
  };

  function setState(button, auction, state, text, title) {
    if (state) button.dataset.state = state;
    else delete button.dataset.state;
    button.textContent = text ?? idleLabel(auction);
    button.title = title ?? (auction.leading ? "Ta mise est la plus haute" : `Miser ${logic.nextBid(auction)} W sur cette enchère`);
    button.disabled = state === "busy" || state === "done" || ended(auction) || Boolean(auction.leading);
  }

  function flash(button, auction, state, text, title) {
    setState(button, auction, state, text, title);
    setTimeout(() => button.dataset.state === state && setState(button, auction, null), RESET_MS);
  }

  async function refreshAuction(auction, message, sent) {
    auction.leading = false;
    auction.minimum = null;
    try {
      const json = await wmt.api.fetchJson(`/api/marketplace/${auction.id}`);
      const fresh = logic.auctionsFromPayload("/api/marketplace/detail", json)[0];
      if (fresh) Object.assign(auction, fresh);
    } catch {
      auction.current = auction.current ?? null;
    }
    const hinted = logic.minimumFromMessage(message, Math.max(sent, auction.current ?? 0));
    if (hinted !== null) auction.minimum = hinted;
  }

  async function place(button, auction, card) {
    if (busy) return;
    const amount = logic.nextBid(auction);
    busy = true;
    setState(button, auction, "busy", "Mise en cours");
    try {
      const result = await wmt.api.postJson(`/api/marketplace/${auction.id}/bid`, { amount });
      auction.current = Number.isFinite(result?.current_bid) ? result.current_bid : amount;
      auction.minimum = null;
      auction.leading = true;
      setState(button, auction, "done");
    } catch (error) {
      if (error.status === 403 && error.code === HUMAN_CHECK) {
        setState(button, auction, "error", "Vérification requise", "Mise sur la page de l'enchère pour passer la vérification anti-bot");
        card.click();
      } else if (BALANCE_ERROR.test(error.message)) {
        flash(button, auction, "error", error.message.slice(0, 28), error.message);
      } else {
        await refreshAuction(auction, error.message, amount);
        flash(button, auction, "updated", null, `${error.message} (montant mis à jour, clique pour miser à nouveau)`);
      }
    } finally {
      busy = false;
    }
  }

  function decorate(card, title) {
    if (location.pathname !== "/marketplace" || card.querySelector(".wmt-bid")) return;
    const auction = match(tileOf(card), title);
    if (!auction) return;
    const holder = card.querySelector(".mt-auto");
    if (!holder) return;
    card.classList.add("wmt-market-card");
    const button = ui.button("", "wmt-bid");
    setState(button, auction, null);
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      place(button, auction, card);
    });
    holder.appendChild(button);
  }

  wmt.bid = { add, decorate };
})(window);
