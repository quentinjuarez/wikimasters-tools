# Publishing to the Chrome Web Store

## Prerequisites

- A Chrome Web Store developer account (one-time registration fee, 2-step verification on the Google account).
- The privacy policy served at a public URL. With GitHub Pages enabled on the `docs` folder, it is `https://quentinjuarez.github.io/wikimasters-tools/privacy.html`.

## Steps

1. `npm run package` runs the tests, then builds `dist/wikimasters-price-tools-<version>.zip` (manifest, `_locales`, `icons`, `src`).
2. Check the package: unzip it, open `chrome://extensions`, enable developer mode, load the folder unpacked, then use the site while logged in.
3. In the dashboard, create a new item and upload the zip.
4. Store listing tab: paste the texts from [`store/listing.md`](../store/listing.md) (French only), pick the Fun category, upload `icons/icon-128.png`, the four screenshots and the two promo images from `store/screenshots/`.
5. Privacy tab: single purpose, permission justifications, "no remote code", no data collected, the three certifications, the privacy policy URL.
6. Distribution tab: public visibility, free, regions limited to France and French-speaking countries.
7. Test instructions: paste the reviewer paragraph from `store/listing.md`.
8. Submit for review.

## Updating

Bump `version` in `manifest.json` and `package.json`, run `npm run package`, upload the new zip and describe the changes.

## Guardrails

- The name contains "WikiMasters" only to state compatibility, and the listing says the extension is unofficial. If the site's owner asks for a different name, change it in `_locales/*/messages.json`.
- The site's community rules forbid tools that play on the player's behalf. Keep every action click-driven: no bulk selling or bidding, no automatic pack opening.
- Any new permission or new host in `matches` slows the review and needs a justification.
