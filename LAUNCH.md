# SkillLoom — Extension Release & Store Submission Guide

SkillLoom ships exclusively as a **Chromium Manifest V3 browser extension** with zero companion server, zero native messaging host, and zero cloud backend.

## Build Store-Ready Packages

```bash
npm run lint
npm test
npm run package:release
npm run store:assets   # runs headless browser UI checks & renders 1280x800 store screenshots + 440x280 tile
```

Outputs in `dist-release/`:
- `dist-release/skillloom-chromium-extension/` — Unpacked MV3 extension (for local sideloading in Chrome, Edge, Brave, or Opera).
- `dist-release/skillloom-chromium-mv3-extension.zip` — Shared Chromium MV3 archive.
- `dist-release/stores/` — Store-ready ZIP packages for Chrome Web Store, Microsoft Edge Add-ons, Brave, and Opera Add-ons.
- `dist-release/store-assets/` — Generated `1280×800` screenshots and `440×280` small promo tile.
- `dist-release/release-manifest.json` — Machine-readable build manifest.

See [PRIVACY.md](./PRIVACY.md) and [docs/STORE-SUBMISSION.md](./docs/STORE-SUBMISSION.md) for Privacy Policy text, Single Purpose statement, and store permission justifications.

## Pre-Submission Checklist

1. Verify `apps/extension/manifest.json` requests only minimal scoped permissions (`activeTab`, `scripting`, `storage`, `tabCapture`, `offscreen`) and optional host permissions for loopback Ollama/LM Studio and BYOK providers.
2. Confirm `npm run lint` and `npm test` exit `0`.
3. Load `dist-release/skillloom-chromium-extension/` unpacked in Chrome/Edge and verify YouTube capture, Instagram Reel capture, Popup Quality Gate display, Skill Studio preview, Plan A folder install, and Plan B copy prompt / ZIP export.
4. Do not mark any store listing as published until the respective store approves the submission and issues its final Extension ID.
