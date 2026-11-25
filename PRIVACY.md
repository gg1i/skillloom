# SkillLoom Privacy Policy

**Effective Date:** November 25, 2026  
**Product:** SkillLoom — Free Local-First Video & Reels to AI Skills (Chromium MV3 Extension)

## 1. Summary
SkillLoom runs **100% locally in your browser**. It has **no developer-operated backend servers, no user accounts, no cloud databases, no analytics, and no telemetry**. We do not collect, transmit, sell, or store any of your browsing history, video data, transcripts, screenshots, audio recordings, generated skills, or API keys on SkillLoom servers.

## 2. Data Accessed and Why
SkillLoom only accesses page data on `youtube.com` and `instagram.com` **after you open a tutorial or Reel and trigger capture/distillation**:
- **Public Tutorial Context:** Video title, creator name, URL, description, chapters, pinned/creator comments, hashtags, and visible caption/transcript segments extracted from the active tab DOM.
- **Visual Keyframes & Audio (User-Initiated Only):** Canvas/tab frame snapshots and temporary tab-audio capture (`tabCapture` + `offscreen`) occur only when you trigger Auto-Frames, Record Audio, or Open Skill Studio on an active video/Reel.

All processing (text cleaning, ASR correction, domain checklists, canvas frame scoring, quality gate checks, and `.zip` / `SKILL.md` packaging) executes strictly inside your browser.

## 3. Local Storage
SkillLoom uses `chrome.storage.local` and browser `IndexedDB` solely on your device to store:
- Temporary captured keyframes and audio for the active tutorial (`capturedFramesByVideo`, `capturedAudioByVideo`, `pendingAgentBundle`).
- Optional AI provider settings and any API key you choose to supply (`skillloomAiConfig`), stored only in your local browser profile.
- An optional `FileSystemDirectoryHandle` in IndexedDB pointing to the local skills folder you selected via the File System Access API (Plan A direct install).

You can clear this data at any time by removing captured frames in the UI, clearing extension site data, or uninstalling the extension.

## 4. Third-Party AI Providers (Strictly Optional)
By default (`AI: Draft`), SkillLoom makes **zero external network requests**.

If you explicitly enable an AI provider in settings:
- **Local Runtimes (Ollama / LM Studio):** Requests are restricted strictly to loopback addresses (`http://127.0.0.1` or `http://localhost`) on your own computer.
- **Bring Your Own Key (Gemini, Groq, OpenRouter, OpenAI):** Your browser requests optional host permission for that specific provider and sends the tutorial context directly to that provider's official HTTPS API using your personal API key. Those requests are governed by the privacy policy of the provider you chose.

## 5. Security Protections
- Untrusted web text (captions, descriptions, comments) is sanitized against prompt-injection patterns and redacted for accidental secret patterns before generating `SKILL.md`.
- Skill packages block path traversal and executable script extensions (`.sh`, `.bat`, `.cmd`, `.ps1`, `.exe`, `.dll`, `.vbs`).

## 6. Contact & Source
Questions or privacy requests can be opened on the public project repository issue tracker where SkillLoom is distributed.
