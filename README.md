# SkillLoom — Turn YouTube Tutorials & Instagram Reels into Agent Skills

SkillLoom is a **100% local, extension-only Chromium MV3 browser extension** (Chrome, Edge, Brave, Opera) that converts YouTube tutorials and Instagram Reels into concise, structured, self-contained **Agent Skills (`SKILL.md`)**.

- **Zero servers, zero accounts, zero telemetry.** Everything runs directly in your browser.
- **Strong without any LLM:** The built-in rule-based distiller cleans transcripts, fixes technical ASR typos, extracts commands/prompts/links/versions, attaches `[mm:ss]` timestamps, adds generic domain checklists with clear provenance labels, and scores every skill before install.
- **Optional Local AI / BYOK:** Connect local **Ollama** / **LM Studio** (loopback-only) or your own API key (**Gemini**, **Groq**, **OpenRouter**, **OpenAI**) for multimodal enrichment and automatic 1-pass quality repair.
- **Plan A (Direct Install) & Plan B (Copy Prompt / ZIP):** Install directly into your agent's skills directory via the browser File System Access API, or copy the full prompt / download a pure-browser PKZIP package.

## Quick Start

```bash
npm run lint
npm test
npm run package:release
```

Then open `chrome://extensions` or `edge://extensions`, enable **Developer Mode**, click **Load unpacked**, and choose:

```
dist-release/skillloom-chromium-extension
```

## Documentation

- [PROJECT.md](./PROJECT.md) — Full project overview, module map, and `SKILL.md` format
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — Extension-only local architecture and pipeline stages
- [docs/SECURITY.md](./docs/SECURITY.md) — Untrusted content isolation, secret redaction, and path safety
- [docs/ROADMAP.md](./docs/ROADMAP.md) — Current capabilities and future direction
- [LAUNCH.md](./LAUNCH.md) — Store packaging and release checklist
