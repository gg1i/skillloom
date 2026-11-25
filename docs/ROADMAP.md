# SkillLoom Product Roadmap

## Current Release (Extension-Only Local-First v2)
- Live on [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/skillloom-%E2%80%94-free-localfi/hgonifdpcgeeoenaffajegmlceinnihn) and installable via unpacked ZIP from [GitHub Releases](https://github.com/gg1i/skillloom/releases/tag/v2.0.0) across Chrome, Edge, Brave, and Opera.
- Zero companion binary, zero native messaging, zero MCP server, zero accounts.
- High-signal rule-based distiller with source cleaning, technical ASR typo fixes, negation-aware tool detection, timestamped step extraction, vague-reference resolution, and size-adaptive output (`long`, `medium`, `short`, `reel`).
- Domain- and tool-keyed generic checklists with strict provenance labeling (`[From video — mm:ss]` vs. `[Added — not from video]`).
- Zero-dependency canvas content-density keyframe scoring plus optional local Ollama / LM Studio and BYOK multimodal enrichment.
- Lightweight in-extension Quality Gate with score + gaps UI in Popup and Skill Studio, 1-pass AI repair when a model is configured, and automatic `draft` labeling + refinement checklist otherwise.
- Plan A direct skills-folder install and Plan B copy-prompt / pure-browser PKZIP export.

## Planned Improvements
- Expanded ASR technical correction dictionaries and additional domain checklists (mobile development, databases, hardware/embedded, data engineering).
- Optional browser-native WebGPU / local speech-to-text integration when browser APIs mature without inflating extension bundle size.
- Support for technical documentation pages and structured course portals using the same 7-section `SKILL.md` format and provenance contract.
- Chrome Web Store and Opera Add-ons store publication once submitted and approved.
