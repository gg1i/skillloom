# SkillLoom Architecture — Extension-Only, Local-First Design

SkillLoom runs **100% inside a Chromium Manifest V3 browser extension** with zero SkillLoom-operated servers, zero companion binaries, and zero native messaging hosts.

## Core Pipeline

1. **Page Extraction (`apps/extension/content/`, `apps/extension/lib/dom-extract-utils.ts`)**
   - Extracts browser-visible YouTube transcripts, chapters, descriptions, pinned comments, and unwrapped reference links.
   - Extracts Instagram Reel captions, hashtags, creator comments, unwrapped external links, optional tab-audio recordings (via `offscreen/`), and timestamped canvas/tab keyframes.
   - Scores captured canvas keyframes locally with a zero-dependency luminance edge/contrast heuristic (`scoreCanvasFrameContent`) to prioritize frames showing code, terminals, UI settings, or slides.

2. **Rule-Based Distiller (`apps/extension/lib/skill-distiller.ts`)**
   - Sanitizes untrusted text against prompt injection, dangerous shell pipelines, and leaked secrets.
   - Strips filler speech, sponsor reads, intros/outros, engagement bait, and localized YouTube/Instagram DOM chrome.
   - Corrects technical speech-recognition typos while preserving verbatim CLI commands, flags, file paths, and values.
   - Detects tools with negation filtering (e.g., excluding tools mentioned only as "without X" or in outro plugs), explicit versions, hashtags, and useful links.
   - Extracts structured steps from imperative verbs, ordinal markers, chapters, and code-like tokens with `[mm:ss]` timestamps, merges restated steps, and resolves vague references (`this`, `here`) using chapter and surrounding context.
   - Adapts output structure by source size: `long` (chapter/phase sections + `references/chapter-details.md`), `medium` (standard skill), and `short` / `reel` (focused mini-skill weighting post text, hashtags, comments, and keyframes with explicit scope/limitations).

3. **Domain Checklists & Skill Compiler (`domain-checklists.ts`, `browser-skill-builder.ts`)**
   - Adds generic, safe prerequisites, verification checks, common mistakes, and "when not to use" boundaries keyed on detected domain and tools.
   - Enforces strict provenance labeling everywhere (`[From video — mm:ss]` / `[From Reel caption]` / `[From frame mm:ss]` vs. `[Added — not from video]` and `## Added context (not from the video)`).
   - Never invents specific commands, flags, versions, or numeric parameters not present in the source.
   - Compiles the exact 7-section `SKILL.md` format, offloads extended evidence and frames under `references/`, and packages pure-browser PKZIP archives.

4. **Optional Local AI / BYOK Enrichment (`apps/extension/lib/ai-engine.ts`)**
   - Supports local loopback runtimes (**Ollama**, **LM Studio**) and user-owned BYOK providers (**Gemini**, **Groq**, **OpenRouter**, **OpenAI**), with keys stored strictly in `chrome.storage.local`.
   - Applies the same 7-section format, provenance rules, and no-invention constraints.

5. **In-Extension Quality Gate (`apps/extension/lib/skill-quality-gate.ts`)**
   - Runs automatically after generation and before Plan A / Plan B delivery.
   - Validates structure (frontmatter, trigger/exclusion description, safe paths, no secrets, no dangerous scripts) and content (action + concrete object per step, timestamps, no duplicates/placeholders/filler, concrete specificity).
   - Surfaces score and concise gaps in both the Popup and Skill Studio.
   - On low score: runs one targeted AI repair pass if a model is configured; otherwise marks the skill as a `draft` and appends a concise agent-refinement checklist in `## Source and limitations`.

6. **Local Delivery (`repo-installer.ts`, `popup/popup.ts`, `popup/handoff.ts`)**
   - **Plan A:** Writes the skill directory directly into the user's chosen local skills folder via the File System Access API (persisted in IndexedDB).
   - **Plan B:** Copies the full prompt + files to clipboard or downloads a pure-browser `.zip` or single `SKILL.md`.
