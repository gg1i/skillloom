# SkillLoom Security & Privacy Model (Extension-Only Local-First)

## 1. Zero Servers, Zero Accounts, Zero Telemetry
- SkillLoom operates **no backend servers**, no user accounts, no cloud storage, and no analytics or telemetry.
- All transcript parsing, distillation, frame scoring, quality gating, and ZIP packaging happen locally inside the browser extension.
- Optional AI calls go directly from the user's browser only to the local loopback runtime (Ollama / LM Studio) or BYOK endpoint explicitly configured and permission-approved by the user.

## 2. Scoped Extension Permissions & Loopback Guard
- `apps/extension/manifest.json` requests only scoped permissions (`activeTab`, `scripting`, `storage`, `tabCapture`, `offscreen`) and explicit host access for YouTube and Instagram.
- External AI provider origins and loopback endpoints are requested only as `optional_host_permissions` when the user enables a provider.
- Local AI providers (`ollama`, `lm_studio`) strictly enforce `isLoopbackEndpoint()` (`127.0.0.1`, `localhost`, `::1`) so local traffic never leaves the machine.
- User BYOK keys are stored only in `chrome.storage.local` and are never embedded in extension source or exported into generated skills.

## 3. Untrusted Content Isolation & Prompt-Injection Defense
- All scraped YouTube captions, descriptions, comments, and Instagram Reel text are treated as **UNTRUSTED DATA** (`sanitizeUntrustedText` in `skill-distiller.ts`).
- Prompt-injection overrides (`ignore all previous instructions`, policy bypasses), credential exfiltration directives, destructive shell patterns (`curl | bash`, `rm -rf /`, `Invoke-Expression`), and embedded secrets/API keys (`sk-...`, `AIza...`, `ghp_...`, `gsk_...`, private key blocks) are neutralized (`[SANITIZED_UNTRUSTED_PATTERN]` / `[REDACTED_SECRET]`) before skill compilation.
- `references/source-evidence.md` carries an explicit untrusted-data security notice.

## 4. Pre-Install Quality Gate Safety Blocks
- Before Plan A direct folder install, `evaluateSkillQualityGate()` verifies:
  - **Safe archive paths:** rejects `..`, absolute paths, Windows drive prefixes, backslashes, and null bytes (`isSafeArchivePath`).
  - **No executable script files:** blocks `.sh`, `.bat`, `.cmd`, `.ps1`, `.exe`, `.dll`, and `.vbs` files inside generated packages.
  - **Zero leaked secrets or unneutralized injections** in any generated text file.
  - **Valid YAML frontmatter** with safe lowercase kebab-case `name` and JSON-quoted `description`.
- Any structural security violation sets grade `BLOCKED` and prevents Plan A installation.
