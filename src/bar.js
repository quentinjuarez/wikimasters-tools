(function (root) {
  const wmt = root.WMT;

  function mount() {
    const bar = wmt.ui.el("button", "wmt-bar");
    bar.type = "button";
    bar.title = "Estimation de la collection";
    const dot = wmt.ui.el("span", "wmt-dot");
    const label = wmt.ui.el("span", "wmt-bar-label");
    bar.append(dot, label);
    let timer = null;

    function update() {
      const status = wmt.prices.status();
      const busy = status.queued + status.active;
      if (status.cooldownMs) label.textContent = `Pause du site, reprise dans ${Math.ceil(status.cooldownMs / 1000)} s`;
      else if (busy) label.textContent = `${busy} prix en chargement`;
      else label.textContent = `${wmt.ui.format(status.cached)} prix en cache`;
      dot.dataset.state = status.cooldownMs ? "paused" : busy ? "busy" : "idle";
      if (busy && !timer) timer = setInterval(update, 1000);
      if (!busy && timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    bar.addEventListener("click", () => wmt.estimate.toggle());
    wmt.prices.onChange(update);
    update();
    document.body.appendChild(bar);
  }

  wmt.bar = { mount };
})(window);
