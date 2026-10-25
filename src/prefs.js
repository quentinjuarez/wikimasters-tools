(function (root) {
  const wmt = root.WMT;
  const { ui } = wmt;
  const SECTIONS = {
    "/marketplace": { key: "autoMarket", label: "Calcul automatique des prix du marché" },
    "/global-collection": { key: "autoGlobal", label: "Calcul automatique des prix de la collection globale" },
  };
  const DETAIL = /^\/marketplace\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/?$/i;
  let prefs = { autoMarket: true, autoGlobal: false, rememberFilters: true };
  let strip = null;
  let stripSection = null;

  const sectionOf = () => Object.keys(SECTIONS).find((path) => location.pathname === path || location.pathname.startsWith(`${path}/`));

  async function load() {
    const saved = await wmt.store.get("prefs");
    prefs = {
      autoMarket: saved?.autoMarket !== false,
      autoGlobal: saved?.autoGlobal === true,
      rememberFilters: saved?.rememberFilters !== false,
    };
  }

  const isDetail = () => DETAIL.test(location.pathname);

  function autoAllowed() {
    if (isDetail()) return true;
    const section = sectionOf();
    return section ? prefs[SECTIONS[section].key] : true;
  }

  function build(section) {
    const { key, label } = SECTIONS[section];
    const node = ui.el("div", "card-frame wmt-strip");
    const auto = ui.toggle(label, prefs[key]);
    auto.box.addEventListener("change", () => {
      prefs = { ...prefs, [key]: auto.box.checked };
      wmt.store.set("prefs", prefs);
      wmt.badges.refreshAll();
    });
    node.append(
      ui.el("span", "wmt-strip-label", "Prix"),
      auto.label,
      ui.el("span", "wmt-muted", "Désactivé, chaque carte a un bouton « Calculer » pour l'ajouter à la file d'attente."),
    );
    return node;
  }

  function syncPage() {
    const section = location.pathname === "/marketplace" || location.pathname === "/marketplace/" || location.pathname === "/global-collection" ? sectionOf() : null;
    if (!section) {
      strip?.remove();
      strip = null;
      return;
    }
    if (strip?.isConnected && stripSection === section) return;
    strip?.remove();
    const header = document.querySelector("main h1")?.parentElement;
    if (!header) return;
    strip = build(section);
    stripSection = section;
    header.insertAdjacentElement("afterend", strip);
  }

  function set(key, value) {
    prefs = { ...prefs, [key]: value };
    wmt.store.set("prefs", prefs);
  }

  wmt.prefs = { load, autoAllowed, isDetail, syncPage, get: (key) => prefs[key], set };
})(window);
