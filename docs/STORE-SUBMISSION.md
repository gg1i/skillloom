# Store Submission Guide (Chrome Web Store, Edge Add-ons & Opera Add-ons)

Everything below is ready to copy-paste when submitting `dist-release/stores/*.zip`.

---

## 1. Upload Files (`npm run package:release`)
- **Chrome Web Store / Brave:** `dist-release/stores/skillloom-chrome-web-store-v2.0.0.zip`
- **Microsoft Edge Add-ons:** `dist-release/stores/skillloom-microsoft-edge-addons-v2.0.0.zip`
- **Opera Add-ons:** `dist-release/stores/skillloom-opera-addons-v2.0.0.zip`
- **Store Listing Screenshots & Promo Tile:** Generated in `dist-release/store-assets/` (`1280×800` screenshots + `440×280` small promo tile).
- **Privacy Policy:** Commit and publish `PRIVACY.md` at a public HTTPS URL (for example via GitHub raw/Pages from your repository) and paste that URL into the store dashboard's Privacy Policy field.

---

## 2. Single Purpose Statement
> SkillLoom converts a user's currently open YouTube tutorial or Instagram Reel into a local, structured Agent Skill (`SKILL.md`) package, scores its quality, and lets the user save it directly to their chosen local skills folder or copy/export it as a ZIP archive.

---

## 3. Permission Justifications

### `activeTab`
Required when the user clicks the SkillLoom toolbar icon on an open YouTube or Instagram Reel tab so the extension can read the active video's title, URL, visible metadata, and capture user-triggered tab screenshots or tab audio.

### `scripting`
Required as a fallback on Instagram/YouTube tabs where the page was already open before install or after SPA navigation, allowing the extension to inject the matching content extractor (`youtube-detector.js` or `instagram-detector.js`) only after user interaction or host permission grant.

### `storage`
Required (`chrome.storage.local`) to temporarily pass the extracted tutorial/frames between the Popup and Skill Studio (`handoff.html`), remember dismissed onboarding hints, and store optional user-configured local AI (Ollama) or BYOK settings locally on-device.

### `tabCapture` & `offscreen`
Used strictly when the user clicks **"Record Audio"** on a short tutorial or Instagram Reel that lacks exposed subtitles/captions. An MV3 offscreen document (`offscreen/offscreen.html`) records the tab audio stream locally in WebM Opus while routing playback audio back to the user's speakers so sound stays audible, then passes the audio locally to the user's configured BYOK Whisper/Gemini endpoint if enabled.

### Host Permissions (`https://www.youtube.com/*`, `https://www.instagram.com/*`, `https://instagram.com/*`)
Required for the domain-specific DOM extractors (`youtube-detector.ts` and `instagram-detector.ts`) that read publicly rendered video titles, chapters, descriptions, pinned/creator comments, hashtags, and visible `<track>` captions, as well as canvas keyframes.

### Optional Host Permissions (`http://127.0.0.1/*`, `http://localhost/*`, `generativelanguage.googleapis.com`, `openrouter.ai`, `api.openai.com`, `api.groq.com`)
Requested dynamically at runtime **only if** the user selects local Ollama/LM Studio (`127.0.0.1`/`localhost`) or enters their own BYOK API key for one of those providers. Never requested or used in the default offline Rule-Based Draft mode.

### Remote Code Declaration
- **"Are you using remote code?" → No.** All JavaScript (extension UI, rule-based distiller, domain checklists, keyframe scorer, quality gate, and ZIP builder) is bundled directly inside the extension ZIP via `esbuild`.

---

## 4. Data Usage / Privacy Practices Checklist (CWS)
- **What data does the extension collect or transmit to developer servers?** **None.** SkillLoom runs 100% locally with zero telemetry and zero developer servers.
- **User disclosures to check:**
  - Website content (YouTube / Instagram visible tutorial metadata, transcripts, frames, optional user-triggered tab audio) is processed **only locally in the browser** and, if the user explicitly configures an optional BYOK API provider, sent directly from the user's browser to that chosen provider using the user's own API key.
  - Authentication/credentials: User BYOK API keys (if entered) remain strictly in `chrome.storage.local` and are only sent as headers/query params to the corresponding provider selected by the user.
  - Certify all 3 Google Limited Use / non-selling / non-ads / non-creditworthiness attestations.
