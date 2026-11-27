# SkillLoom — Turn YouTube, Reels & X/Twitter into Agent Skills or Study Notes

SkillLoom is a **100% local, extension-only Chromium MV3 browser extension** (Edge, Chrome, Brave, Opera) with **2 output modes**:

- **🤖 Agent Skill (`SKILL.md`):** Turn YouTube tutorials, Instagram Reels, and X / Twitter threads or videos into clean, audited AI Agent Skills.
- **📚 Study Notes (`NOTES.md`):** Turn lectures, courses, and technical threads into Obsidian-ready revision notes with Active Recall flashcards and exam traps.
- **Zero servers, zero accounts, zero telemetry.** Everything runs directly in your browser.
- **Strong without any LLM:** Rule-based distiller cleans transcripts/threads, fixes technical ASR typos, extracts commands/links/versions, attaches `[mm:ss]` timestamps, and scores every output before install.
- **Optional Local AI / BYOK:** Connect local **Ollama** / **LM Studio** (`127.0.0.1`) or your own API key (**Gemini**, **Groq**, **OpenRouter**, **OpenAI**) with live model auto-discovery.
- **Plan A (Direct Folder Save) & Plan B (Copy Prompt / ZIP):** Save straight into your local Agent Skills folder (`~/.claude/skills`, `~/.gemini/config/skills`, `.cursor`, etc.) or your **Study Vault** folder via the File System Access API, or copy/ZIP in 1 click.

## Install

- **Microsoft Edge Add-ons (1-Click Install):** [Get SkillLoom on Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/skillloom-%E2%80%94-free-localfi/hgonifdpcgeeoenaffajegmlceinnihn)
- **Chrome / Brave / Opera (Manual Sideload):** Download `skillloom-chromium-mv3-extension.zip` from [GitHub Releases](https://github.com/gg1i/skillloom/releases/tag/v2.1.0), unzip it, open `chrome://extensions` (or `brave://extensions` / `opera://extensions`), enable **Developer mode**, and click **Load unpacked**.

## Build From Source

```bash
npm run lint
npm test
npm run package:release
```

Then load `dist-release/skillloom-chromium-extension` via **Developer Mode → Load unpacked**.

## Documentation

- [PROJECT.md](./PROJECT.md) — Full project overview, module map, and `SKILL.md` format
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — Extension-only local architecture and pipeline stages
- [docs/SECURITY.md](./docs/SECURITY.md) — Untrusted content isolation, secret redaction, and path safety
- [docs/ROADMAP.md](./docs/ROADMAP.md) — Current capabilities and future direction
- [LAUNCH.md](./LAUNCH.md) — Store packaging and release checklist
