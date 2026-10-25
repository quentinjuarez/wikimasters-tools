const fs = require("node:fs");
const path = require("node:path");
const { shoot, work } = require("./build.js");

const root = path.join(__dirname, "..");
const icon = fs.readFileSync(path.join(root, "assets/icon.svg"), "utf8");
const shell = fs.readFileSync(path.join(__dirname, "shell.css"), "utf8");
const extension = fs.readFileSync(path.join(root, "src/style.css"), "utf8");
const fonts = "https://fonts.googleapis.com/css2?family=Inter:wght@500;600;700&family=Outfit:wght@600;700&display=swap";

const card = (rarity, title, price, rotate, left, top, scale = 1) => `<div class="relative rounded-2xl overflow-hidden card" data-r="${rarity}" style="position:absolute;left:${left}px;top:${top}px;transform:rotate(${rotate}deg) scale(${scale});box-shadow:0 18px 40px rgba(0,0,0,.55)">
  <div class="rar">${rarity}</div><div class="art"></div>
  <div class="body"><h3>${title}</h3><div class="mt-auto"><div class="border-t stats"><span style="color:#047857">${price} W</span><span>moy.</span></div></div></div></div>`;

const page = (width, height, body, extra = "") => `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${fonts}"><style>${shell}\n${extension}
body { width:${width}px; height:${height}px; overflow:hidden; background: radial-gradient(120% 120% at 85% 10%, #123d2f 0%, #0c0d0c 60%); position: relative; }
.brand { position:absolute; display:flex; flex-direction:column; gap:14px; }
.brand svg { width:var(--icon); height:var(--icon); }
.brand h2 { margin:0; font-family: var(--font-heading); font-weight:700; line-height:1.05; color:#f2f4f3; }
.brand h2 em { font-style: normal; color: var(--color-accent); }
${extra}
</style></head><body>${body}</body></html>`;

function build() {
  const small = page(
    440,
    280,
    `<div class="brand" style="left:28px;top:34px;--icon:64px;width:230px">${icon}<h2 style="font-size:27px">Les prix de <em>WikiMasters</em>, partout</h2></div>
     ${card("UR", "Tour Eiffel", 451, 8, 262, 60, 0.62)}${card("R", "Mont Blanc", 63, -7, 300, 110, 0.62)}`,
  );
  const marquee = page(
    1400,
    560,
    `<div class="brand" style="left:90px;top:130px;--icon:110px;width:640px">${icon}<h2 style="font-size:64px">Les prix de <em>WikiMasters</em>, partout</h2></div>
     ${card("L", "Mont Blanc", 798, -9, 800, 130, 1.05)}${card("UR", "Tour Eiffel", 451, 4, 985, 90, 1.05)}${card("SR", "Marie Curie", 96, 11, 1160, 150, 1.05)}`,
  );
  fs.writeFileSync(path.join(work, "promo-small.html"), small);
  fs.writeFileSync(path.join(work, "promo-marquee.html"), marquee);
  console.log(shoot("promo-small", 440, 280, "promo-small-440x280"));
  console.log(shoot("promo-marquee", 1400, 560, "promo-marquee-1400x560"));
}

build();
