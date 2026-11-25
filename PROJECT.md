# SkillLoom — Extension-Only Local-First Video & Reels to Agent Skills

SkillLoom is a **100% local, extension-only Chromium MV3 browser extension** (Google Chrome, Microsoft Edge, Brave, Opera) that turns **YouTube tutorials** and **Instagram Reels** into self-contained, executable **Agent Skills** (`SKILL.md` packages) without servers, accounts, telemetry, or companion binaries.

---

## Architecture Overview

```
YouTube / Instagram Reel Tab (DOM + Captions + Comments + Keyframes + Optional Tab Audio)
        │
        ▼
Content Scripts (`apps/extension/content/youtube-detector.ts`, `instagram-detector.ts`)
  + Canvas Keyframe Content-Density Scoring (`apps/extension/lib/dom-extract-utils.ts`)
        │
        ▼
Rule-Based Distiller v2 (`apps/extension/lib/skill-distiller.ts`)
  • Strips filler, sponsors, intros/outros, CTAs, localized DOM chrome
  • Fixes technical ASR errors while preserving verbatim commands/flags/paths/code
  • Detects tools with negation filtering, versions, hashtags, and useful links
  • Extracts timestamped `[mm:ss]` structured steps & resolves vague references
  • Adapts output to source size: `long` / `medium` / `short` / `reel`
        │
        ▼
Domain Checklists + Package Builder (`domain-checklists.ts`, `browser-skill-builder.ts`)
  • Emits exact 7-section `SKILL.md` with strict provenance labeling everywhere
  • Offloads extended chapter notes, raw evidence, and keyframes to `references/`
  • Zero fabricated commands, flags, versions, or numeric values
        │
        ▼
Optional Local AI / BYOK Enrichment (`apps/extension/lib/ai-engine.ts`)
  • Ollama / LM Studio (strictly loopback) or user BYOK (Gemini, Groq, OpenRouter, OpenAI)
  • Enforces the same 7-section format and provenance rules
        │
        ▼
Lightweight In-Extension Quality Gate (`apps/extension/lib/skill-quality-gate.ts`)
  • Structural checks: frontmatter, trigger/exclusion description, path safety, zero secrets,
    zero dangerous scripts or unneutralized prompt injections
  • Content checks: action + concrete object per step, timestamps, no placeholders/duplicates/filler
  • Score (0–100) + concise gap list displayed in Popup and Skill Studio
  • Low score + model configured → 1 targeted repair pass; otherwise labeled as `draft`
    with an agent refinement checklist
        │
        ▼
Delivery (Zero Companion Binary Required)
  • Plan A: Direct folder install via File System Access API (`repo-installer.ts`)
  • Plan B: Copy full agent prompt or download pure-browser PKZIP / single `SKILL.md`
  • Skill Studio (`popup/handoff.html`): Inspect all files, edit slug, paste screenshots, refine
```

---

## Repository Structure

- `apps/extension/manifest.json` — MV3 extension manifest (scoped permissions: `activeTab`, `scripting`, `storage`, `tabCapture`, `offscreen`; optional host permissions for loopback Ollama/LM Studio and BYOK APIs).
- `apps/extension/background/service-worker.ts` — Local MV3 service worker handling offscreen tab-audio recording, slide frame capture, visible-tab screenshot fallback, and Skill Studio launch.
- `apps/extension/content/` — DOM extractors for YouTube (`youtube-detector.ts`) and Instagram Reels (`instagram-detector.ts`).
- `apps/extension/offscreen/` — Offscreen MediaRecorder for optional local tab-audio capture.
- `apps/extension/lib/`:
  - `skill-distiller.ts` — Source cleaning, ASR typo correction, negation-aware tool/version/URL extraction, structured step detection, reference resolution, size classification, and security sanitization.
  - `domain-checklists.ts` — Generic, safe domain- and tool-keyed checklists for prerequisites, verification, common mistakes, and when not to use (never invents commands or versions).
  - `browser-skill-builder.ts` — 7-section `SKILL.md` compiler, `references/` offloading, keyframe selection, and pure-browser PKZIP archive builder.
  - `skill-quality-gate.ts` — Post-generation structural and content quality gate, draft annotation, and 1-pass AI repair prompt builder.
  - `ai-engine.ts` — Optional local (Ollama / LM Studio loopback) and BYOK (Gemini, Groq, OpenRouter, OpenAI) multimodal enrichment and 1-pass quality repair.
  - `ai-settings-panel.ts` — Local settings drawer persisted strictly in `chrome.storage.local`.
  - `dom-extract-utils.ts` — URL unwrapping, active video detection, storyboard capture, contact sheets, and zero-dependency canvas content-density frame scoring.
  - `repo-installer.ts` — Plan A direct local folder installer using IndexedDB-persisted `FileSystemDirectoryHandle`.
  - `browser-compat.ts` — Chromium family detection (Chrome, Edge, Brave, Opera).
- `apps/extension/popup/` — Popup (`popup.html`, `popup.ts`) and Skill Studio (`handoff.html`, `handoff.ts`) with live Quality Gate score and gap reporting.
- `packaging/` — Extension release builder (`build-release.ts`) and store distribution metadata (`browser-distribution.json`) producing unpacked builds and store-ready ZIPs for Chrome, Edge, Brave, and Opera.
- `tests/` — Golden fixtures (`tests/fixtures/golden-videos.ts`) and unit tests (`tests/unit/`).
- `docs/` — Architecture, security, and roadmap documentation.

---

## Standard Output Format (`SKILL.md`)

Every generated skill uses this exact layout so agents can execute reliably without watching the video:

```markdown
---
name: <slug>
description: "<what it does + when to use it + when not to use it>"
---
# Title
## When to use
## Prerequisites
## Steps (actionable steps with exact commands/values and [mm:ss] timestamps)
## Verify it worked
## Common mistakes / troubleshooting
## Added context (not from the video)
## Source and limitations (URL, date, capture profile, and what the source did not cover)
```

Extended chapter breakdowns (for long tutorials), cleaned source evidence, and timestamped keyframes are stored under `references/` so `SKILL.md` remains concise.

---

## Development & Release Commands

```bash
npm run lint             # TypeScript type-check (tsc --noEmit)
npm test                 # Run unit and golden-fixture tests
npm run package:release  # Build unpacked MV3 extension + browser store ZIPs in dist-release/
```

Load the unpacked extension from `dist-release/skillloom-chromium-extension` via `chrome://extensions` or `edge://extensions` (Developer Mode → Load unpacked).
