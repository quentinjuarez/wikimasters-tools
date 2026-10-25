const { test } = require("node:test");
const assert = require("node:assert");
const { JSDOM } = require("jsdom");
const { onKeyDown } = require("../src/packs.js");

function page(html) {
  const dom = new JSDOM(`<body><main>${html}</main></body>`);
  const clicked = [];
  dom.window.document.querySelectorAll("button").forEach((button) => button.addEventListener("click", () => clicked.push(button.textContent.trim() || button.id)));
  return { doc: dom.window.document, clicked, window: dom.window };
}

const press = (ctx, key, extra = {}) => {
  const event = new ctx.window.KeyboardEvent("keydown", { key, cancelable: true, ...extra });
  onKeyDown(event, ctx.doc, "/pulls");
  return event;
};

test("fleche haut ouvre, bas ferme", () => {
  const closed = page("<button>Ouvrir</button>");
  press(closed, "ArrowUp");
  press(closed, "ArrowDown");
  assert.deepStrictEqual(closed.clicked, ["Ouvrir"]);

  const reveal = page('<button id="prev" class="w-12 h-12">x</button><button>Continuer</button>');
  press(reveal, "ArrowDown");
  press(reveal, "ArrowUp");
  assert.deepStrictEqual(reveal.clicked, ["Continuer"]);
});

test("gauche et droite pilotent les boutons ronds, sauf desactives", () => {
  const ctx = page('<button id="prev" class="w-12 h-12" disabled></button><button id="next" class="w-12 h-12"></button>');
  press(ctx, "ArrowLeft");
  press(ctx, "ArrowRight");
  assert.deepStrictEqual(ctx.clicked, ["next"]);
});

test("ignore les champs de saisie, les modificateurs et les autres pages", () => {
  const ctx = page('<input id="field"><button>Ouvrir</button>');
  const field = ctx.doc.getElementById("field");
  onKeyDown({ key: "ArrowUp", target: field }, ctx.doc, "/pulls");
  press(ctx, "ArrowUp", { shiftKey: true });
  onKeyDown({ key: "ArrowUp", target: ctx.doc.body, preventDefault() {} }, ctx.doc, "/collection");
  assert.deepStrictEqual(ctx.clicked, []);
});
