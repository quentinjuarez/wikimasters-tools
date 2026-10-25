# Architecture

A Manifest V3 extension written in plain JavaScript, with no build step. Every file in `src/` is loaded as a content script on `https://www.wiki-masters.com/*` and registers itself on a shared `WMT` namespace.

## Data flow

```
site fetch ──► hook.js (page world) ──postMessage──► app.js ──► registry / bid
                                                       │
card DOM ──► badges.js ──► prices.js (queue) ──► site API (sales summary)
                               │
                               ▼
                           store.js ──► chrome.storage.local
```

- `hook.js` runs in the page's own JavaScript world and wraps `fetch`. It forwards the JSON of a short allow-list of site endpoints (collection, cards, marketplace, packs, trades) so the extension learns card ids and auctions without extra requests.
- Everything else runs in the extension's isolated world.

## Modules

| File | Role |
|---|---|
| `logic.js` | Pure functions: cache model, filters and sorting, rate-limit parsing, payload extraction, bid and progress maths. No DOM, no I/O. |
| `store.js` | Persistence behind one small interface (`get`, `set`, `loadAll`, `putMany`, `deleteMany`). `chrome.storage.local` in production, IndexedDB and memory implementations for tests and migration. |
| `api.js` | `fetch` wrapper with timeout, retry on 5xx and a typed `HttpError`. |
| `prices.js` | The price queue (see below). |
| `collection.js` | Targeted collection sync by rarity page ranges or by tag, saved by diff. |
| `registry.js` | Maps card titles to ids and owned copies. |
| `badges.js` | Binds cards in the DOM to ids and paints price badges. |
| `bar.js`, `estimate.js` | The status pill and the estimation panel. |
| `sale.js`, `bid.js` | Per-card Sell and Bid buttons. |
| `priceview.js`, `filters.js` | The "price, descending" sort and saved filters, both driven through the site's own controls. |
| `prefs.js`, `packs.js`, `ui.js` | Settings strips, pack keyboard shortcuts, small DOM helpers. |

## Key decisions

**One price request at a time.** The site has no bulk price endpoint and rate-limits aggressively, so `prices.js` is a single-flight queue with two priorities. A manual click goes to the top. On a 429 it honors `Retry-After`, otherwise it pauses with exponential backoff capped at five minutes. It learns a request gap from the pauses it triggers, relaxes it after a run of successes, and exposes a manual delay setting.

**Durable cache, never overwritten by errors.** A known price does not expire and a failed request never erases it. Writes are per record with a short debounce, so recalculating one card does not rewrite the whole cache. Storage lives in the extension's own area, not in the page's origin, so site-side clearing cannot remove it.

**Use the site's UI instead of replacing it.** Saved filters are restored by driving the site's own search box, tag menu and rarity chips. The price sort is an extra option injected into the site's sort menu. Styles reuse the site's CSS variables and card frame so the extension follows its theme.

**Actions only on click.** Selling and bidding happen on an explicit click, one action per click. There is no bulk action and no automatic pack opening. When the site asks for a human verification, the extension fills in the site's own form and leaves the final click, and the verification, to the user.

**Stable DOM.** Rendering code skips work when nothing changed, so hover, text selection and clicks are never lost to a rebuild loop.

## Tests

`npm test` runs unit tests for the pure logic, the queue, the sync and the stores, plus integration tests that load the real scripts into jsdom with a fake IndexedDB and a stubbed `fetch`. `tests/release.test.js` guards the store requirements: manifest shape, icons, locales, no remote code, no HTML injection, and no host other than the site.

## Known limits

- Selectors depend on the site's current markup. A redesign can break badge placement or the saved-filter restore.
- The Pro endpoint with full sales history is not used; prices come from the public summary endpoint.
- The minimum bid is computed from the displayed bid plus 10 percent, rounded up. If the site refuses a bid, the extension re-reads the auction and uses the minimum from the site's message when there is one.
