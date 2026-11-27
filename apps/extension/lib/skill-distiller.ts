/**
 * SkillLoom Pure-Browser Rule-Based Distiller (v2)
 *
 * Cleans noisy YouTube transcripts and Instagram Reel captures, fixes technical ASR typos,
 * extracts structured steps (imperatives, ordinals, chapters, code/prompt tokens) with
 * `[mm:ss]` timestamps, resolves vague references, detects tools with negation filtering,
 * extracts versions & useful URLs, and adapts output granularity to source size.
 *
 * Zero network calls, zero external dependencies, strict security sanitization preserved.
 */

export interface RawTranscriptSegment {
  startSeconds?: number;
  endSeconds?: number;
  timestampLabel?: string;
  text?: string;
}

export interface RawChapter {
  title: string;
  startSeconds: number;
}

export interface RawPinnedComment {
  author: string;
  text: string;
  isCreator?: boolean;
}

export interface RawLabeledLink {
  label: string;
  url: string;
  source: 'description' | 'pinned_comment';
}

export interface ExtractedArtifact {
  kind: 'command' | 'prompt' | 'config' | 'path' | 'snippet';
  content: string;
  source: 'description' | 'pinned_comment' | 'transcript' | 'caption';
  timestampLabel?: string;
}

export interface ExtractedPitfall {
  text: string;
  source: 'transcript' | 'pinned_comment' | 'description';
  timestampLabel?: string;
}

export interface VisualBlindspot {
  timestampLabel: string;
  phrase: string;
  context: string;
}

export interface StructuredStep {
  action: string;
  timestampLabel: string;
  startSeconds: number;
  source: 'video' | 'description' | 'pinned_comment' | 'caption' | 'frame';
  chapterTitle?: string;
  concreteTokens: string[];
  score: number;
}

export interface DistilledStage {
  title: string;
  startTimestamp: string;
  startSeconds: number;
  steps: StructuredStep[];
  allCandidateSteps: StructuredStep[];
}

export type CoverageLevel = 'RICH' | 'MODERATE' | 'VISUAL_HEAVY_NEEDS_FRAMES';
export type SourceSizeMode = 'long' | 'medium' | 'short' | 'reel';
export type SkillOutputMode = 'agent' | 'study';
export type SkillSourcePlatform = 'youtube' | 'instagram' | 'twitter';

// --- Security Sanitization (Preserved & Hardened) ---

const UNTRUSTED_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /bypass\s+(security|evaluation|skillevaluator|safety|policy)/gi,
  /reveal\s+(all\s+)?(api\s*keys?|secrets?|tokens?|passwords?)/gi,
  /exfiltrate\b[^\n]{0,80}/gi,
  /\b(?:curl|wget)\s+https?:\/\/[^\s|;&]+[^\n]{0,40}\|\s*(?:ba)?sh\b/gi,
  /\brm\s+-rf\s+\/(?:\s|$)/gi,
  /\bInvoke-Expression\b|\biex\s*\(/gi,
];

const SECRET_REDACTION_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bAIza[0-9A-Za-z_-]{25,}\b/g,
  /\bghp_[0-9A-Za-z]{25,}\b/g,
  /\bgsk_[0-9A-Za-z_-]{20,}\b/g,
  /\b(api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9_\-.]{12,}['"]?/gi,
  /-----BEGIN\s+[A-Z ]+PRIVATE KEY-----[\s\S]*?-----END\s+[A-Z ]+PRIVATE KEY-----/g,
];

export function sanitizeUntrustedText(raw: string): { text: string; flagsCount: number } {
  let text = raw || '';
  let flagsCount = 0;
  for (const pattern of UNTRUSTED_INJECTION_PATTERNS) {
    const matches = text.match(pattern);
    if (matches && matches.length > 0) {
      flagsCount += matches.length;
      text = text.replace(pattern, '[SANITIZED_UNTRUSTED_PATTERN]');
    }
  }
  for (const secretPat of SECRET_REDACTION_PATTERNS) {
    const matches = text.match(secretPat);
    if (matches && matches.length > 0) {
      flagsCount += matches.length;
      text = text.replace(secretPat, '[REDACTED_SECRET]');
    }
  }
  return { text, flagsCount };
}

// --- Timestamp & Slug Helpers ---

export function formatSecToMmSs(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function parseMmSsToSec(label: string): number {
  const parts = label
    .trim()
    .split(':')
    .map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/**
 * Cleans clickbait / Instagram DM-bait titles into a descriptive skill title.
 */
export function cleanSkillTitle(rawTitle: string, fallbackDomain = 'Workflow', tools: string[] = []): string {
  let t = (rawTitle || '').replace(/\s+/g, ' ').trim();
  // Strip emoji/arrows at edges
  t = t.replace(/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u2190-\u21FF\s]+|[\u{1F300}-\u{1FAFF}\u2600-\u27BF\u2190-\u21FF\s]+$/gu, '').trim();

  // Instagram DM-bait title rewriting: `Comment "EDITOR" and I'll send you the prompt that turns Claude into your own video editor`
  const dmHookExtract = t.match(
    /^(?:comment|reply|dm|type)\s+["'“”]?[A-Za-z0-9_-]{2,24}["'“”]?\s+(?:and|to|for)\s+(?:i(?:'|’)?ll\s+(?:send|dm)\s+you\s+)?(?:the\s+)?(?:free\s+)?(?:prompt|guide|workflow|tool|link|template|script)?\s*(?:that\s+|to\s+|for\s+)?(.+)$/i
  );
  if (dmHookExtract && dmHookExtract[1] && dmHookExtract[1].trim().length >= 12) {
    let core = dmHookExtract[1].trim();
    core = core.replace(/^turns?\s+/i, 'Turn ');
    core = core.charAt(0).toUpperCase() + core.slice(1);
    t = core;
  } else if (/^(?:comment|dm|reply)\s+["'“”]?[A-Za-z0-9_-]{2,24}["'“”]?\s+(?:for|to get)\s+/i.test(t)) {
    const stripped = t.replace(/^(?:comment|dm|reply)\s+["'“”]?[A-Za-z0-9_-]{2,24}["'“”]?\s+(?:for|to get)\s+(?:the\s+)?/i, '').trim();
    if (stripped.length >= 8) {
      t = stripped.charAt(0).toUpperCase() + stripped.slice(1);
    } else if (tools.length > 0) {
      t = `${tools.slice(0, 2).join(' + ')} ${fallbackDomain} Workflow`;
    }
  }

  // Strip trailing channel/hype clickbait suffixes like `| Full Tutorial 2026` or `(INSANE!)`
  t = t
    .replace(/\s*\(\s*(?:FREE!?|INSANE!?|CRAZY!?|100%\s*FREE!?)\s*\)\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return t || `${tools[0] || fallbackDomain} Skill`;
}

export function toSafeSlug(raw: string, fallbackId: string): string {
  const cleaned = (raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  if (cleaned.length >= 3) return cleaned;
  const fallback = (fallbackId || 'video')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `video-skill-${fallback || 'draft'}`;
}

// --- Technical ASR Typo Correction ---

const ASR_TECH_FIXES: Array<[RegExp, string]> = [
  // Networking
  [/\bcomp\.?\s*tia'?s?\b/gi, 'CompTIA'],
  [/\bnetwork\s+plus\b/gi, 'Network+'],
  [/\bcat\s*five,?\s*(?:he|e)\b/gi, 'Cat5e'],
  [/\bcat\s*5\s*e\b/gi, 'Cat5e'],
  [/\bcat\s*six\s*a\b/gi, 'Cat6a'],
  [/\b10\s*g\s*b\s*e\b/gi, '10GbE'],
  [/\b10\s*gb\s*e\b/gi, '10GbE'],
  [/\bI\s*scuzzy\b/gi, 'iSCSI'],
  [/\bfq\s*dn\b/gi, 'FQDN'],
  [/\bgr\s+E\b/g, 'GRE'],
  [/\bv\s*lan\b/gi, 'VLAN'],
  [/\bo\s*s\s*p\s*f\b/gi, 'OSPF'],
  [/\bd\s*h\s*c\s*p\b/gi, 'DHCP'],
  [/\bd\s*n\s*s\b/gi, 'DNS'],
  [/\bi\s*p\s*v\s*4\b/gi, 'IPv4'],
  [/\bi\s*p\s*v\s*6\b/gi, 'IPv6'],
  [/\bs\s*s\s*i\s*d\b/gi, 'SSID'],
  [/\b255\s+dot\s+0\.0\s+dot\s+zero\b/gi, '255.0.0.0'],
  [/\b255\s+dot\s+255\s+dot\s+0\s+dot\s+0\b/gi, '255.255.0.0'],
  [/\b255\s+dot\s+255\s+dot\s+255\s+dot\s+0\b/gi, '255.255.255.0'],
  // AI / Coding / Video / 3D
  [/\banti[-\s]?gravity\b/gi, 'Antigravity'],
  [/\b(?:claud|clad|cloud)\s+code\b/gi, 'Claude Code'],
  [/\b(?:re-?motion|remote\s+shin)\b/gi, 'Remotion'],
  [/\bposter(?:ize|\s+eyes)\s+time\b/gi, 'posterizeTime'],
  [/\b(?:11|eleven)\s+labs\b/gi, 'ElevenLabs'],
  [/\bcap\s+cut\b/gi, 'CapCut'],
  [/\bf\s*f\s*m\s*p\s*e\s*g\b/gi, 'FFmpeg'],
  [/\bthree\s*(?:\.|dot)?\s*js\b/gi, 'Three.js'],
  [/\bnext\s*(?:\.|dot)?\s*js\b/gi, 'Next.js'],
  [/\bnode\s*(?:\.|dot)?\s*js\b/gi, 'Node.js'],
  [/\btype\s+script\b/gi, 'TypeScript'],
  [/\bjava\s+script\b/gi, 'JavaScript'],
  [/\bpost\s*gres(?:ql)?\b/gi, 'PostgreSQL'],
  [/\bsuper\s+base\b/gi, 'Supabase'],
  [/\bver\s*cell\b/gi, 'Vercel'],
  [/\bget\s+hub\b/gi, 'GitHub'],
  [/\bcube\s*(?:control|ctl)\b/gi, 'kubectl'],
  [/\bmark\s+down\b/gi, 'Markdown'],
  [/\bweb\s*g\s*l\b/gi, 'WebGL'],
  [/\bg\s*l\s*t\s*f\b/gi, 'glTF'],
  [/\bgoogle\s+ai\s+studio\b/gi, 'Google AI Studio'],
  [/\bgoogle\s+fonts?\b/gi, 'Google Fonts'],
  [/\bclaude\s+sonnet\b/gi, 'Claude Sonnet'],
  [/\btype\s+at\s+(?=[a-z0-9_-]+)/gi, 'type @'],
];

export function fixAsrTechErrors(text: string): string {
  // Protect verbatim URLs and CLI commands from case-altering ASR fixes
  const protectedChunks: string[] = [];
  let out = text.replace(
    /https?:\/\/[^\s<>"'`)\]]+|\b(?:npm|npx|pnpm|yarn|bun|pip3?|uv|git|docker(?:\s+compose)?|kubectl|helm|ollama|ffmpeg|ipconfig|ifconfig|ping|traceroute|nslookup|dig)\s+[a-z0-9._/:@="',+-]+(?:\s+[a-z0-9._/:@="',+-]+){0,7}/gi,
    (match) => {
      const idx = protectedChunks.length;
      protectedChunks.push(match);
      return `__SL_CMD_${idx}__`;
    }
  );
  for (const [pattern, replacement] of ASR_TECH_FIXES) {
    out = out.replace(pattern, replacement);
  }
  out = out.replace(/__SL_CMD_(\d+)__/g, (_m, idxStr: string) => protectedChunks[Number(idxStr)] || '');
  return out;
}

// --- Description & YouTube UI Chrome Cleaning ---

const YOUTUBE_UI_CHROME_RE =
  /(?:…\s*afficher\s+plus|…\s*more|\.\.\.\s*more|\d[\d\s,.]*(?:k|m)?\s*(?:abonnés|subscribers|vues|views)|suivez\s+la\s+vidéo\s+à\s+l'aide\s+de\s+la\s+transcription|afficher\s+la\s+transcription|show\s+transcript|s'abonner|subscribe|rejoindre|join|partager|share|télécharger|download|enregistrer|save|signaler|report)/gi;

export function cleanDescriptionText(raw: string): string {
  if (!raw) return '';
  let text = raw.replace(/\r\n/g, '\n');
  // Cut localized YouTube DOM footer appended below description ("…afficher plus 931 abonnés ... Transcription")
  const chromeCutIdx = text.search(
    /(?:…\s*afficher\s+plus|suivez\s+la\s+vidéo\s+à\s+l'aide\s+de\s+la\s+transcription|afficher\s+la\s+transcription|show\s+transcript\s+follow\s+along)/i
  );
  if (chromeCutIdx > 40) {
    text = text.slice(0, chromeCutIdx);
  }
  const lines = text
    .split('\n')
    .map((line) => line.replace(YOUTUBE_UI_CHROME_RE, '').replace(/\s+/g, ' ').trim())
    .filter((line) => line.length > 0 && !/^(?:transcription|transcript|vidéos|à propos|about)$/i.test(line));
  return fixAsrTechErrors(lines.join('\n')).trim();
}

// --- Sponsor, Intro/Outro & CTA Filtering ---

const SPONSOR_BLOCK_RE =
  /\b(?:this\s+video\s+is\s+sponsored\s+by|brought\s+to\s+you\s+by|thanks?\s+to\s+\S+\s+for\s+sponsoring|today'?s\s+sponsor|our\s+sponsor|use\s+(?:my\s+)?(?:promo\s+)?code\s+\w+\s+for\s+\d+%|get\s+\d+%\s+off\s+(?:your\s+first|with\s+my\s+link)|nordvpn|surfshark|squarespace|brilliant\.org|skillshare|audible\.com)\b/i;

const FILLER_OR_CTA_SENTENCE_RE =
  /^(?:(?:hey|hi|hello|yo|what['’]?s\s+up)\s+(?:everyone|guys|folks|there|y['’]?all|i['’]?m\s+\w+)|welcome\s+(?:back\s+)?to\s+(?:my|the|this)\s+(?:channel|video|course|tutorial)|thanks?\s+(?:so\s+much\s+)?for\s+watching|don['’]?t\s+forget\s+to\s+(?:like|subscribe|hit)|(?:like|smash|hit)\s+(?:the\s+|that\s+)?(?:like|subscribe|bell|notification)|subscribe\s+(?:to\s+(?:my|the)\s+channel|for\s+more)|follow\s+(?:me\s+)?for\s+more|comment\s+below|leave\s+a\s+comment|drop\s+a\s+comment|check\s+out\s+(?:my\s+)?(?:other|next|previous)\s+video|watch\s+(?:my\s+)?(?:next|other)\s+video|if\s+you\s+(?:want\s+to\s+see|enjoyed|liked)\s+this\s+video|i['’]?ll\s+see\s+you\s+(?:in\s+the\s+next|next\s+time)|let['’]?s\s+(?:jump|dive|get)\s+(?:right\s+)?in(?:to\s+it)?|give\s+me\s+\w+\s+minutes?\s+and\s+i['’]?ll\s+show\s+you|link\s+in\s+(?:my\s+)?bio|save\s+this\s+(?:reel|post|video)\s+for\s+later|move\s+on\s+to\s+(?:how|the|dynamic|our)\b)/i;

const REEL_ENGAGEMENT_BAIT_RE =
  /\b(?:comment\s+["'“”]?[a-z0-9_-]{2,20}["'“”]?\s+(?:and|to|for)\s+(?:i['’]?ll\s+(?:send|dm)|it['’]?s\s+yours|get\s+the)|i['’]?ll\s+(?:send|dm)\s+you\s+the\s+(?:prompt|link|guide)|want\s+the\s+(?:prompt|guide|link)\b.*\bcomment\b|dm\s+me\s+["'“”]?[a-z0-9_-]+|most\s+ai\s+\w+\s+look\s+like\s+slop|follow\s+for\s+more|save\s+this\s+reel|share\s+with\s+a\s+friend)\b/i;

const CONVERSATIONAL_PREFIX_RE =
  /^(?:so\s+|now\s+|okay\s*,?\s*|alright\s*,?\s*|well\s*,?\s*|basically\s*,?\s*|actually\s*,?\s*|um+\s*,?\s*|uh+\s*,?\s*|and\s+then\s+|then\s+|next\s*,?\s*|first\s*,?\s*|second\s*,?\s*|third\s*,?\s*|finally\s*,?\s*|lastly\s*,?\s*|step\s+\d+[:.)-]?\s*|what\s+you(?:'re|\s+are)\s+gonna\s+(?:want\s+to\s+)?do\s+is\s+|what\s+you\s+want\s+to\s+do\s+is\s+|you(?:'re|\s+are)\s+going\s+to\s+(?:want\s+to\s+)?|you\s+(?:just\s+)?(?:need|want|have)\s+to\s+|all\s+you\s+(?:need|have)\s+to\s+do\s+is\s+|we(?:'re|\s+are)\s+(?:going\s+to|gonna)\s+|i(?:'m|\s+am)\s+(?:going\s+to|gonna)\s+|let'?s\s+(?:go\s+ahead\s+and\s+)?|go\s+ahead\s+and\s+|make\s+sure\s+(?:you\s+|to\s+)?|you\s+can\s+(?:also\s+|just\s+)?|here\s+we\s+can\s+|now\s+we\s+can\s+)+/i;

// --- Expanded Tool Detection with Negation Awareness ---

const KNOWN_TOOLS: Array<[RegExp, string]> = [
  [/\bclaude\s+code\b/i, 'Claude Code'],
  [/\bclaude\b/i, 'Claude'],
  [/\bantigravity\b/i, 'Antigravity'],
  [/\bgoogle\s+ai\s+studio\b/i, 'Google AI Studio'],
  [/\bgemini\b/i, 'Gemini'],
  [/\bcursor\b/i, 'Cursor'],
  [/\bcodex\b/i, 'Codex'],
  [/\bchatgpt\b/i, 'ChatGPT'],
  [/\bollama\b/i, 'Ollama'],
  [/\blm\s*studio\b/i, 'LM Studio'],
  [/\bopenrouter\b/i, 'OpenRouter'],
  [/\bgroq\b/i, 'Groq'],
  [/\bwhisper\b/i, 'Whisper'],
  [/\bkokoro\b/i, 'Kokoro TTS'],
  [/\bremotion\b/i, 'Remotion'],
  [/\bhyperframes?\b/i, 'HyperFrames'],
  [/\bafter\s+effects\b/i, 'After Effects'],
  [/\bcapcut\b/i, 'CapCut'],
  [/\belevenlabs\b/i, 'ElevenLabs'],
  [/\bffmpeg\b/i, 'FFmpeg'],
  [/\bthree\.?js\b/i, 'Three.js'],
  [/\bwebgl\b/i, 'WebGL'],
  [/\bblender\b/i, 'Blender'],
  [/\bunity\b/i, 'Unity'],
  [/\bunreal\b/i, 'Unreal Engine'],
  [/\broblox\s+studio\b/i, 'Roblox Studio'],
  [/\bnext\.?js\b/i, 'Next.js'],
  [/\breact\b/i, 'React'],
  [/\btailwind(?:\s+css)?\b/i, 'Tailwind CSS'],
  [/\bvite\b/i, 'Vite'],
  [/\btypescript\b|\bnode\.?js\b|\bnpm\b|\bpnpm\b|\bnpx\b/i, 'TypeScript / Node.js'],
  [/\bpython\b|\bpip3?\b|\buv\b|\bpytest\b/i, 'Python'],
  [/\bfastapi\b/i, 'FastAPI'],
  [/\bdocker(?:\s+compose)?\b/i, 'Docker'],
  [/\bkubernetes\b|\bkubectl\b|\bhelm\b/i, 'Kubernetes'],
  [/\bterraform\b/i, 'Terraform'],
  [/\bgithub(?:\s+actions)?\b|\bgit\b/i, 'Git / GitHub'],
  [/\bpostgresql\b|\bpostgres\b/i, 'PostgreSQL'],
  [/\bsupabase\b/i, 'Supabase'],
  [/\bvercel\b/i, 'Vercel'],
  [/\bcloudflare\b/i, 'Cloudflare'],
  [/\bplaywright\b/i, 'Playwright'],
  [/\bchrome\b/i, 'Chrome'],
  [/\bgoogle\s+fonts?\b/i, 'Google Fonts'],
  [/\bvs\s*code\b/i, 'VS Code'],
  [/\bn8n\b/i, 'n8n'],
  [/\bghidra\b/i, 'Ghidra'],
  [/\bx64dbg\b/i, 'x64dbg'],
  [/\bida\s*pro\b/i, 'IDA Pro'],
  [/\bradare2\b/i, 'Radare2'],
  [/\bwireshark\b/i, 'Wireshark'],
  [/\bnmap\b/i, 'Nmap'],
  [/\bburp\s+suite\b/i, 'Burp Suite'],
  [/\bcisco\b/i, 'Cisco IOS'],
  [/\bcomptia\s+network\+/i, 'CompTIA Network+'],
  [/\b(?:dhcp|dns|ospf|bgp|vlan|nat|snmp|ssh|tls)\b/i, 'TCP/IP Networking Stack'],
];

const NEGATED_TOOL_CONTEXT_RE =
  /\b(?:no|not|without|don'?t\s+need|do\s+not\s+need|instead\s+of|replace|replacing|ditch|ditching|skip|forget|vs\.?|versus|unlike|better\s+than|watch\s+my\s+.{0,30}\s+video|check\s+out\s+my\s+.{0,30}\s+video|next\s+video)\b/i;

export interface ToolDetectionResult {
  tools: string[];
  excludedTools: string[];
}

export function detectToolsWithNegation(
  title: string,
  description: string,
  pinnedText: string,
  sentences: Array<{ text: string; startSeconds?: number }>,
  durationSeconds = 0
): ToolDetectionResult {
  const affirmativeCounts = new Map<string, number>();
  const negatedCounts = new Map<string, number>();

  const checkChunk = (chunk: string, weight: number, isOutroWindow = false) => {
    const clean = fixAsrTechErrors(chunk);
    for (const [regex, name] of KNOWN_TOOLS) {
      const m = clean.match(regex);
      if (!m || m.index === undefined) continue;

      const beforeWindow = clean.slice(Math.max(0, m.index - 45), m.index);
      const aroundWindow = clean.slice(
        Math.max(0, m.index - 35),
        Math.min(clean.length, m.index + m[0].length + 35)
      );

      const isNegated =
        NEGATED_TOOL_CONTEXT_RE.test(beforeWindow) ||
        /\b(?:watch\s+my|check\s+out\s+my|my\s+next\s+video|other\s+video)\b/i.test(aroundWindow) ||
        (isOutroWindow && /\b(?:video|channel|tutorial|next|watch)\b/i.test(clean));

      if (isNegated) {
        negatedCounts.set(name, (negatedCounts.get(name) || 0) + 1);
      } else {
        affirmativeCounts.set(name, (affirmativeCounts.get(name) || 0) + weight);
      }
    }
  };

  // Strip "Related videos / Watch next" cross-promo footer from description before tool detection
  const descForTools = description.replace(
    /(?:^|\n)\s*(?:related\s+videos?|watch\s+next|more\s+videos?|other\s+videos?)\s*:?[\s\S]*$/i,
    ''
  );

  // Split title/description/pinned by clause so "no After Effects" only negates After Effects
  for (const part of [title, ...descForTools.split(/\n|[.!?]+/), ...pinnedText.split(/\n|[.!?]+/)]) {
    if (part.trim()) checkChunk(part, 3, false);
  }

  const outroThreshold = durationSeconds > 90 ? durationSeconds * 0.88 : Infinity;
  for (const s of sentences) {
    const isOutro = Boolean(s.startSeconds && s.startSeconds >= outroThreshold);
    checkChunk(s.text, 1, isOutro);
  }

  // If Claude Code is affirmatively detected, keep Claude Code (and don't double-list bare Claude unless Claude also appears independently)
  if ((affirmativeCounts.get('Claude Code') || 0) > 0) {
    const claudeTotal = affirmativeCounts.get('Claude') || 0;
    const ccTotal = affirmativeCounts.get('Claude Code') || 0;
    if (claudeTotal <= ccTotal) {
      affirmativeCounts.delete('Claude');
    }
  }

  const tools = Array.from(affirmativeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, 8);

  const excludedTools = Array.from(negatedCounts.keys()).filter((name) => !affirmativeCounts.has(name));

  return { tools, excludedTools };
}

// --- Domain Detection ---

const DOMAIN_RULES: Array<{ domain: string; titleRegex: RegExp; bodyRegex: RegExp }> = [
  {
    domain: 'Cybersecurity',
    titleRegex: /\b(?:reverse\s*engineer|ghidra|x64dbg|malware|pentest|ctf|exploit|decompile|burp\s*suite|security\s*audit|vulnerability)\b/i,
    bodyRegex: /\b(?:reverse\s*engineer|ghidra|x64dbg|ida\s*pro|disassembl|decompile|malware|pentest|exploit|burp\s*suite|nmap|wireshark)\b/i,
  },
  {
    domain: 'Networking',
    titleRegex: /\b(?:network\+|networking\s+course|comptia\s+network|tcp\/ip|subnetting|vlan|bgp|ospf|cisco|osi\s+model|routing\s+and\s+switching|firewall|dhcp|dns)\b/i,
    bodyRegex: /\b(?:subnet(?:ting| mask)|osi\s+model|tcp\/ip|vlan|ospf|bgp|dhcp|dns\s+record|ipv4|ipv6|router|switch|ethernet|cat5e|cat6|cidr|nat\b|arp\b|icmp)\b/i,
  },
  {
    domain: 'Motion graphics',
    titleRegex: /\b(?:motion\s+graphics?|remotion|after\s+effects|video\s+edit(?:or|ing)?|collage\s+reel|animation\s+reel|documentary\s+edit|sfx|keyframe|hyperframes|capcut)\b/i,
    bodyRegex: /\b(?:motion\s+graphics?|remotion|posterizetime|after\s+effects|keyframe|sound\s+effects?|sfx\s+pack|video\s+editor|capcut|elevenlabs|timeline|render\s+mp4)\b/i,
  },
  {
    domain: '3D modeling',
    titleRegex: /\b(?:3d\s+(?:model|animation|scene|engine|asset|render)|three\.?js|blender|webgl|gltf|glb|shader|mesh|rigging)\b/i,
    bodyRegex: /\b(?:3d\s+(?:model|animation|scene|engine|mesh)|three\.?js|blender|webgl|gltf|glb|uv\s+unwrap|shader|vertex|raycast|orbitcontrols)\b/i,
  },
  {
    domain: 'DevOps & Cloud',
    titleRegex: /\b(?:docker|kubernetes|k8s|terraform|ci\/cd|github\s+actions|nginx|linux\s+server|deploy|vps|aws|gcp|cloudflare)\b/i,
    bodyRegex: /\b(?:dockerfile|docker\s+compose|kubernetes|kubectl|helm|terraform|ingress|ci\/cd|github\s+actions|systemd|nginx|cloudflare\s+workers)\b/i,
  },
  {
    domain: 'Web / Frontend',
    titleRegex: /\b(?:react|next\.?js|tailwind|html|css|frontend|web\s+app|website|landing\s+page|chrome\s+extension|browser\s+extension|vue|svelte)\b/i,
    bodyRegex: /\b(?:react|next\.?js|tailwind|vite|dom\b|css\b|html\b|rest\s+api|endpoint|express|supabase|vercel)\b/i,
  },
  {
    domain: 'AI / Agents',
    titleRegex: /\b(?:ai\s+agent|agent\s+skill|claude\s+code|antigravity|gemini|ollama|llm|rag\b|prompt\s+engineering|vibe\s+cod|ai\s+workflow|voice\s+typing)\b/i,
    bodyRegex: /\b(?:agent\s+skill|claude\s+code|antigravity|gemini|ollama|system\s+prompt|context\s+window|llm|fine-?tun|whisper)\b/i,
  },
];

export function detectDomain(
  title: string,
  description: string,
  transcriptSample: string,
  detectedTools: string[]
): string {
  const titleNorm = fixAsrTechErrors(title);
  const bodyNorm = fixAsrTechErrors(`${description}\n${transcriptSample.slice(0, 6000)}`);

  // Score each domain: title match is worth 5, body matches add up to 4, tool alignment adds 2
  let bestDomain = 'Technical Engineering';
  let bestScore = 0;

  for (const rule of DOMAIN_RULES) {
    let score = 0;
    if (rule.titleRegex.test(titleNorm)) score += 5;
    const bodyMatches = bodyNorm.match(new RegExp(rule.bodyRegex.source, 'gi'));
    if (bodyMatches) score += Math.min(4, Math.ceil(bodyMatches.length / 2));
    if (
      (rule.domain === 'Motion graphics' &&
        detectedTools.some((t) => ['Remotion', 'FFmpeg', 'CapCut', 'ElevenLabs', 'HyperFrames'].includes(t))) ||
      (rule.domain === '3D modeling' &&
        detectedTools.some((t) => ['Three.js', 'WebGL', 'Blender', 'Unity', 'Unreal Engine'].includes(t))) ||
      (rule.domain === 'Networking' &&
        detectedTools.some((t) => ['CompTIA Network+', 'Cisco IOS', 'Wireshark', 'TCP/IP Networking Stack'].includes(t))) ||
      (rule.domain === 'Cybersecurity' &&
        detectedTools.some((t) => ['Ghidra', 'x64dbg', 'Burp Suite', 'Nmap'].includes(t)))
    ) {
      score += 2;
    }

    if (score > bestScore) {
      bestScore = score;
      bestDomain = rule.domain;
    }
  }

  return bestScore >= 2 ? bestDomain : 'Technical Engineering';
}

// --- Versions, Hashtags & Useful URLs ---

export function extractHashtags(text: string): string[] {
  const matches = (text || '').match(/#[a-zA-Z][a-zA-Z0-9_-]{1,32}/g) || [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const key = m.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
    if (out.length >= 12) break;
  }
  return out;
}

export function extractVersionsFromSource(combinedText: string): string[] {
  const clean = fixAsrTechErrors(combinedText);
  const found = new Set<string>();
  const patterns: RegExp[] = [
    /\b(?:Node\.?js|Python|React|Next\.?js|Remotion|Docker|FFmpeg|Tailwind|TypeScript|Blender|Unity|Unreal|Ghidra|Chrome|Gemini|Claude|Opus|Sonnet|Llama|Qwen|Gemma|GPT|HTTP|TLS|USB|Wi-?Fi|Bluetooth)[ ]+(?:v?\d+(?:\.\d+){0,2}[a-z]?)(?!\s*(?:%|minutes?|mins?|seconds?|secs?|hours?|steps?|messages?|videos?|libraries|prompts?|to\b))\b/gi,
    /\b(?:IPv4|IPv6|Cat5e|Cat6a?|10GbE|802\.11[a-z]{1,2}|802\.1Q|TLS\s*1\.[23]|HTTP\/[23])\b/g,
    /\bv\d+\.\d+(?:\.\d+)?\b/g,
  ];
  for (const pat of patterns) {
    for (const m of clean.match(pat) || []) {
      const normalized = m.replace(/\s+/g, ' ').trim();
      // Reject accidental chapter numbers like "Gemini 1" or fractional artifacts like "Gemini 3.8" unless standard
      if (/^Gemini\s+1$/i.test(normalized)) continue;
      if (normalized.length >= 3 && normalized.length <= 32) {
        found.add(normalized);
      }
      if (found.size >= 10) break;
    }
  }
  return Array.from(found);
}

const SKIP_URL_HOST_RE =
  /(?:youtube\.com|youtu\.be|instagram\.com|tiktok\.com|twitter\.com|x\.com|facebook\.com|patreon\.com|ko-fi\.com|buymeacoffee\.com|linktr\.ee\/?$|bit\.ly|tinyurl\.com|nordvpn\.com|squarespace\.com|skillshare\.com|brilliant\.org|audible\.com)/i;

export function extractUsefulLinks(
  labeledLinks: RawLabeledLink[] = [],
  description = '',
  pinnedText = ''
): RawLabeledLink[] {
  const seen = new Set<string>();
  const out: RawLabeledLink[] = [];

  const pushLink = (urlRaw: string, label: string, source: 'description' | 'pinned_comment') => {
    const cleaned = urlRaw.replace(/[),.;!?]+$/, '').trim();
    if (!/^https?:\/\//i.test(cleaned)) return;
    try {
      const u = new URL(cleaned);
      if (SKIP_URL_HOST_RE.test(u.hostname)) return;
      // Strip tracking query params cleanly
      for (const p of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'igsh', 'igshid', 'si']) {
        u.searchParams.delete(p);
      }
      const norm = u.toString();
      if (seen.has(norm)) return;
      seen.add(norm);
      const niceLabel =
        label && label !== cleaned && label.length <= 60
          ? label
          : `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname.slice(0, 32)}`;
      out.push({ label: niceLabel, url: norm, source });
    } catch {
      // ignore invalid URL
    }
  };

  for (const l of labeledLinks) {
    pushLink(l.url, l.label, l.source);
  }
  const urlRe = /https?:\/\/[^\s<>"'`)\]]+/gi;
  for (const m of description.match(urlRe) || []) {
    pushLink(m, '', 'description');
  }
  for (const m of pinnedText.match(urlRe) || []) {
    pushLink(m, '', 'pinned_comment');
  }

  return out.slice(0, 12);
}

// --- Description Chapter Parsing (Crucial for Long Videos) ---

export function parseChaptersFromDescription(description: string): RawChapter[] {
  const chapters: RawChapter[] = [];
  const seenSec = new Set<number>();
  for (const rawLine of (description || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.length > 140) continue;
    // Matches `00:00 Intro`, `1:23:45 Subnetting`, `(02:15) Setup`, `02:15 - Setup`
    const m = line.match(
      /^(?:[-*•]\s*)?(?:\()?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\))?\s*[-–—:|]?\s*(.{2,100})$/
    );
    if (!m) continue;
    const startSeconds = parseMmSsToSec(m[1]);
    const title = fixAsrTechErrors(m[2].replace(/\s*[-–—|]+\s*$/, '').trim());
    if (!title || title.length < 2) continue;
    if (seenSec.has(startSeconds)) continue;
    seenSec.add(startSeconds);
    chapters.push({ title, startSeconds });
  }
  return chapters.sort((a, b) => a.startSeconds - b.startSeconds);
}

export function mergeAndDedupeChapters(domChapters: RawChapter[], description: string): RawChapter[] {
  const descChapters = parseChaptersFromDescription(description);
  const raw = descChapters.length > domChapters.length ? descChapters : domChapters.length > 0 ? domChapters : descChapters;
  const deduped: RawChapter[] = [];
  for (const ch of [...raw].sort((a, b) => a.startSeconds - b.startSeconds)) {
    const cleanTitle = fixAsrTechErrors((ch.title || '').replace(/\s+/g, ' ').trim());
    if (!cleanTitle) continue;
    // Filter pure intro/outro/sponsor chapters
    if (/^(?:sponsor|ad\s+read|promo|outro|subscribe|credits)$/i.test(cleanTitle)) continue;
    const prev = deduped[deduped.length - 1];
    if (prev && Math.abs(ch.startSeconds - prev.startSeconds) < 8) {
      if (cleanTitle.length > prev.title.length && !/duplicate/i.test(cleanTitle)) {
        prev.title = cleanTitle;
      }
      continue;
    }
    if (prev && prev.title.toLowerCase() === cleanTitle.toLowerCase()) continue;
    deduped.push({ title: cleanTitle, startSeconds: Math.max(0, Math.floor(ch.startSeconds)) });
  }
  return deduped;
}

// --- Sentence-Boundary-Aware Transcript Cleaning ---

interface TimedSentence {
  startSeconds: number;
  timestampLabel: string;
  text: string;
}

export function buildCleanTimedSentences(segments: RawTranscriptSegment[]): TimedSentence[] {
  if (!segments || segments.length === 0) return [];

  // 1. Normalize segments and remove sponsor blocks (skip ~45s after sponsor trigger if detected)
  const normalized: Array<{ startSeconds: number; text: string }> = [];
  let skipSponsorUntil = -1;

  for (const seg of segments) {
    const startSeconds =
      typeof seg.startSeconds === 'number' && Number.isFinite(seg.startSeconds)
        ? Math.max(0, seg.startSeconds)
        : seg.timestampLabel
          ? parseMmSsToSec(seg.timestampLabel)
          : 0;

    let text = fixAsrTechErrors(String(seg.text || '').replace(/\s+/g, ' ').trim());
    if (!text) continue;
    // Remove bracketed audio cues like [Music], [Applause], [Laughter]
    text = text.replace(/\[(?:music|applause|laughter|inaudible|cheering)\]/gi, '').trim();
    if (!text) continue;

    if (SPONSOR_BLOCK_RE.test(text)) {
      skipSponsorUntil = startSeconds + 45;
      continue;
    }
    if (startSeconds <= skipSponsorUntil) {
      // Stop skipping early if strong technical action resumes
      if (!/\b(?:install|run|open|create|configure|click|type|subnet|router|command|remotion|three\.js)\b/i.test(text)) {
        continue;
      }
      skipSponsorUntil = -1;
    }

    normalized.push({ startSeconds, text });
  }

  // 2. Stitch adjacent fragments into complete sentences without mid-sentence truncation
  const sentences: TimedSentence[] = [];
  let buf = '';
  let bufStart = 0;
  let lastSec = 0;

  const flushSentencesFromBuffer = (forceFlushAll: boolean) => {
    const trimmed = buf.replace(/\s+/g, ' ').trim();
    if (!trimmed) {
      buf = '';
      return;
    }

    // Split on sentence boundaries while keeping decimals (e.g. 3.1, 192.168.1.1, Node.js, Three.js, .md) intact
    const splitParts: string[] = [];
    let current = '';
    const tokens = trimmed.split(' ');
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      current = current ? `${current} ${tok}` : tok;
      const endsSentence =
        /[!?]$/.test(tok) ||
        (/\.$/.test(tok) &&
          !/\b(?:Mr|Mrs|Ms|Dr|Jr|Sr|vs|etc|e\.g|i\.e|v\d|Node|Next|Three|Vue|React)\.$/i.test(tok) &&
          !/^\d+\.$/.test(tok) &&
          !/\.[a-z0-9]{1,5}\.$/i.test(tok));
      if (endsSentence && current.length >= 24) {
        splitParts.push(current.trim());
        current = '';
      }
    }

    if (forceFlushAll) {
      if (current.trim()) splitParts.push(current.trim());
      buf = '';
    } else {
      buf = current.trim();
    }

    for (const part of splitParts) {
      const cleanPart = part.replace(/\s+/g, ' ').trim();
      if (cleanPart.length < 12) continue;
      if (FILLER_OR_CTA_SENTENCE_RE.test(cleanPart)) continue;
      if (REEL_ENGAGEMENT_BAIT_RE.test(cleanPart)) continue;
      if (SPONSOR_BLOCK_RE.test(cleanPart)) continue;
      sentences.push({
        startSeconds: bufStart,
        timestampLabel: formatSecToMmSs(bufStart),
        text: cleanPart,
      });
    }
  };

  for (const seg of normalized) {
    const gap = seg.startSeconds - lastSec;
    if (buf && (gap > 25 || buf.length >= 340)) {
      flushSentencesFromBuffer(true);
    }
    if (!buf) {
      bufStart = seg.startSeconds;
    }
    buf = buf ? `${buf} ${seg.text}` : seg.text;
    lastSec = seg.startSeconds;

    // If buffer already contains complete sentence terminators, emit completed sentences while keeping tail
    if (/[.!?]\s/.test(buf)) {
      flushSentencesFromBuffer(false);
      if (buf) bufStart = seg.startSeconds;
    }
  }
  flushSentencesFromBuffer(true);

  return sentences;
}

// --- Command, Prompt, Path & Concrete Token Extraction ---

const COMMAND_PREFIX_RE =
  /^(?:\$\s*)?(?:npm|npx|pnpm|yarn|bun|pip3?|uv|git|docker(?:\s+compose)?|kubectl|helm|terraform|ollama|ffmpeg|gh|curl|ssh|ping|traceroute|tracert|ipconfig|ifconfig|netstat|nslookup|dig|chmod|mkdir|cd|cp|mv)\s+(?:--?[a-z]|install|add|run|exec|build|init|create|clone|pull|push|checkout|commit|render|start|serve|apply|get|logs|up|down|-i\b|[a-z0-9._/-]+\.[a-z]{1,5}\b)/i;

const INLINE_COMMAND_RE =
  /\b((?:npm|npx|pnpm|yarn|bun|pip3?|uv|git|docker(?:\s+compose)?|kubectl|helm|ollama|ffmpeg|ipconfig|ifconfig|ping|traceroute|nslookup|dig)(?:\s+(?!(?:and|or|to|on|in|for|with|from|so|that|when|if|because|across|the|your|our|a|an)\b)[a-z0-9._/@:="'+-]+){1,6})/gi;

const FLAG_OR_PATH_RE =
  /(?:--[a-z][a-z0-9-]{1,28}(?:=[a-z0-9._/:+-]+)?|(?:^|[\s(`"'])((?:src|app|apps|out|dist|public|references|components|scripts|config)\/[a-zA-Z0-9._/-]+|\.?\/[a-zA-Z0-9._/-]+|[a-zA-Z0-9_-]+\.(?:ts|tsx|js|jsx|mjs|py|json|ya?ml|md|html|css|mp4|wav|mp3|webm|glb|gltf|png|jpg|sh|toml|env|conf))\b)/gi;

const SPOKEN_PROMPT_RE =
  /(?:\b(?:say|tell\s+(?:it|claude|gemini|antigravity|the\s+agent)|type|prompt(?:\s+it)?|ask\s+(?:it|claude|gemini))\s*[:,-]\s*["'“”]?([^"'\n.!?]{12,160})["'“”]?|["“]([^"”\n]{15,180})["”])/gi;

const TECH_VALUE_RE =
  /\b(?:\d{3,4}x\d{3,4}|\d{1,3}\s*fps|\d{1,3}\s*(?:Mbps|Gbps|Kbps|MHz|GHz|ms|px|rem|em|dB|kHz)|\/\d{1,2}\b|\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?|port\s+\d{2,5}|localhost:\d{2,5}|127\.0\.0\.1:\d{2,5}|#[0-9a-fA-F]{6}\b|\d+\+\s+[a-z]{3,16})/gi;

export function extractConcreteTokens(text: string): string[] {
  const tokens = new Set<string>();
  const clean = fixAsrTechErrors(text);

  for (const m of clean.match(INLINE_COMMAND_RE) || []) {
    tokens.add(m.trim());
  }
  for (const m of clean.matchAll(FLAG_OR_PATH_RE)) {
    const val = (m[1] || m[0]).trim().replace(/^[(`"']+|[)`"',.;]+$/g, '');
    if (val.length >= 3 && !/^https?:/i.test(val)) {
      tokens.add(val);
    }
  }
  for (const m of clean.match(TECH_VALUE_RE) || []) {
    tokens.add(m.trim());
  }
  // Backticked inline code
  for (const m of clean.matchAll(/`([^`\n]{2,80})`/g)) {
    tokens.add(m[1].trim());
  }
  // Known tool names
  for (const [re, name] of KNOWN_TOOLS) {
    if (re.test(clean)) tokens.add(name);
  }

  return Array.from(tokens).slice(0, 8);
}

export function extractCodeAndPromptArtifacts(
  description: string,
  pinnedText: string,
  sentences: TimedSentence[],
  isReel = false
): ExtractedArtifact[] {
  const seen = new Set<string>();
  const artifacts: ExtractedArtifact[] = [];

  const pushUnique = (item: ExtractedArtifact) => {
    const clean = item.content.replace(/\s+/g, ' ').trim();
    if (clean.length < 6 || clean.length > 260) return;
    if (/\[SANITIZED_UNTRUSTED_PATTERN\]|\[REDACTED_SECRET\]/.test(clean)) return;
    if (REEL_ENGAGEMENT_BAIT_RE.test(clean)) return;
    const key = clean.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    artifacts.push({ ...item, content: clean });
  };

  const scanTextBlock = (text: string, source: 'description' | 'pinned_comment' | 'caption') => {
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.length > 260) continue;
      if (REEL_ENGAGEMENT_BAIT_RE.test(line)) continue;

      if (COMMAND_PREFIX_RE.test(line)) {
        pushUnique({ kind: 'command', content: line.replace(/^\$\s*/, ''), source });
        continue;
      }

      const inlineCmds = line.match(INLINE_COMMAND_RE);
      if (inlineCmds) {
        for (const cmd of inlineCmds) {
          pushUnique({ kind: 'command', content: cmd, source });
        }
      }

      const promptMatch = line.match(/^(?:prompt|system\s+prompt|template)\s*[:\-]\s*(.+)$/i);
      if (promptMatch && promptMatch[1]) {
        pushUnique({ kind: 'prompt', content: promptMatch[1].replace(/^["'“”]|["'“”]$/g, ''), source });
        continue;
      }

      for (const m of line.matchAll(/`([^`\n]{4,120})`/g)) {
        const inner = m[1].trim();
        const kind = COMMAND_PREFIX_RE.test(inner) ? 'command' : 'snippet';
        pushUnique({ kind, content: inner, source });
      }
    }
  };

  scanTextBlock(description, isReel ? 'caption' : 'description');
  scanTextBlock(pinnedText, 'pinned_comment');

  // Extract spoken commands, paths, and prompts from transcript sentences
  for (const s of sentences) {
    const cmdMatches = s.text.match(INLINE_COMMAND_RE);
    if (cmdMatches) {
      for (const cmd of cmdMatches) {
        pushUnique({ kind: 'command', content: cmd, source: 'transcript', timestampLabel: s.timestampLabel });
      }
    }

    // Quoted or explicitly spoken prompts ("Turn this into a markdown file", "install the latest version of Remotion skills for me")
    for (const m of s.text.matchAll(SPOKEN_PROMPT_RE)) {
      const candidate = (m[1] || m[2] || '').trim();
      if (
        candidate.length >= 12 &&
        candidate.length <= 160 &&
        !/^(?:comment|editor|jarvis|like|subscribe|hello|hey)/i.test(candidate) &&
        /\b(?:turn|create|build|install|generate|make|write|animate|add|convert|inspect|export|render|fix|configure|markdown|file|skill|remotion|scene|audio|prompt|model|3d|component|code)\b/i.test(
          candidate
        )
      ) {
        pushUnique({ kind: 'prompt', content: candidate, source: 'transcript', timestampLabel: s.timestampLabel });
      }
    }
  }

  return artifacts.slice(0, 14);
}

// --- Imperative & Structured Step Extraction ---

const IMPERATIVE_VERB_RE =
  /\b(install|run|open|create|configure|set(?:\s+up)?|add|copy|paste|drag|drop|click|select|enable|disable|export|render|build|deploy|verify|test|check|inspect|connect|assign|define|prompt|type|save|import|load|generate|preview|update|fix|debug|use|switch|download|navigate|go\s+to|turn|send|feed|upload|split|combine|pass|apply|start|stop|launch|initialize|init|clone|edit|modify|replace|map|bind|route|ping|trace|capture|record|analyze|review|refine|rebase|strip|decompile|disassemble)\b/i;

const ORDINAL_MARKER_RE =
  /\b(?:first|second|third|fourth|step\s+\d+|next|then|after\s+that|once\s+(?:you|that|it)|finally|lastly|before\s+you)\b/i;

const ACTION_START_RE =
  /^(?:Install|Run|Open|Create|Configure|Set|Add|Copy|Paste|Drag|Drop|Click|Select|Enable|Disable|Export|Render|Build|Deploy|Verify|Test|Check|Inspect|Connect|Assign|Define|Prompt|Type|Save|Import|Load|Generate|Preview|Update|Fix|Debug|Use|Switch|Download|Navigate|Go|Turn|Send|Feed|Upload|Split|Combine|Pass|Apply|Start|Stop|Launch|Initialize|Clone|Edit|Modify|Replace|Map|Bind|Route|Ping|Trace|Capture|Record|Analyze|Review|Refine|Ensure|Keep|Avoid|Prefer|Compare|Distinguish|Identify|Calculate|Convert|Troubleshoot)\b/;

/**
 * Resolves vague deictic references ("this", "here", "it", "that") using active chapter
 * and recent named context without inventing any external values.
 */
export function resolveVagueReferences(
  sentence: string,
  chapterTitle: string | undefined,
  recentSubject: string | undefined
): string {
  const anchor = recentSubject || (chapterTitle && !/^(?:intro|overview|conclusion|summary)$/i.test(chapterTitle) ? chapterTitle : '');
  if (!anchor) return sentence;

  let out = sentence;
  // Only clarify standalone vague references when the sentence doesn't already name the anchor
  if (out.toLowerCase().includes(anchor.toLowerCase())) return out;

  out = out.replace(
    /\b(drag|drop|copy|paste|open|put|run|pass|feed|send|turn|load|import|save|export)\s+(this|it|that)\b(?!\s+(?:file|folder|command|prompt|url|link|script|tool|project|code|video|audio|image|model|config|setting))/i,
    (_m, verb: string, pron: string) => `${verb} ${pron} (${anchor})`
  );

  out = out.replace(
    /\b(right\s+here|in\s+here|over\s+here)\b/i,
    `$1 (${anchor})`
  );

  return out;
}

/**
 * Rewrites a cleaned transcript sentence into a concise imperative step while keeping
 * commands, flags, paths, values, and code verbatim.
 */
export function rewriteToImperativeStep(rawSentence: string): string {
  let s = fixAsrTechErrors(rawSentence).replace(/\s+/g, ' ').trim();
  // Strip spoken filler prefixes repeatedly
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(CONVERSATIONAL_PREFIX_RE, '').trim();
  }
  // Remove mid-sentence spoken filler crutches ("you know,", "kind of", "sort of", "basically,")
  s = s
    .replace(/\b(?:you\s+know|i\s+mean|basically|literally|honestly|kind\s+of|sort\s+of)\s*,?\s*/gi, '')
    .replace(/\s+,/g, ',')
    .replace(/\s{2,}/g, ' ')
    .trim();

  // Strip leading pronoun + modal ("you should install..." -> "Install...", "I click..." -> "Click...")
  s = s.replace(/^(?:you\s+(?:should|must|will|can|could)|we\s+(?:should|must|will|can)|i\s+(?:just|will|usually|always)?)\s+/i, '').trim();

  // Strip stray leading punctuation/conjunctions
  s = s.replace(/^[,;:\-–—]+\s*/, '').trim();
  if (!s) return '';

  // Capitalize first letter unless starting with a lowercase CLI command or path
  if (!/^(?:npm|npx|pnpm|yarn|pip|uv|git|docker|kubectl|ffmpeg|ollama|claude|curl|ssh|\.?\/|src\/|out\/)/.test(s)) {
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Keep concise without ever truncating mid-word or mid-backtick
  if (s.length > 220) {
    const cut = s.lastIndexOf(' ', 215);
    s = (cut > 120 ? s.slice(0, cut) : s.slice(0, 215)).replace(/[,;:\-]+$/, '').trim();
  }
  if (!/[.!?`]$/.test(s)) s += '.';
  // Reject mid-sentence truncated fragments ending on dangling prepositions/articles/conjunctions
  if (/\b(?:with|of|to|for|in|on|at|by|from|and|or|but|the|a|an|that|which|either|neither|each)\.$/i.test(s)) {
    return '';
  }

  return s;
}

function stepTokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9/.+-]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !/^(?:the|and|for|with|that|this|from|into|your|then|when|will|have|make|sure|just|into|about|there|here|they|them|what|which)$/.test(w))
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * Merges repeated or restated steps, preserving the earliest timestamp and richer concrete detail.
 */
export function deduplicateAndMergeSteps(steps: StructuredStep[]): StructuredStep[] {
  const kept: Array<{ step: StructuredStep; tokens: Set<string> }> = [];

  for (const candidate of steps) {
    const candTokens = stepTokenSet(candidate.action);
    if (candTokens.size < 2) continue;

    let merged = false;
    for (const entry of kept) {
      const sim = jaccardSimilarity(entry.tokens, candTokens);
      if (sim >= 0.58) {
        // Keep earliest timestamp, prefer higher-scoring / more concrete wording
        const earliestSec = Math.min(entry.step.startSeconds, candidate.startSeconds);
        const earliestTs =
          candidate.startSeconds < entry.step.startSeconds
            ? candidate.timestampLabel
            : entry.step.timestampLabel;
        const mergedConcrete = Array.from(
          new Set([...entry.step.concreteTokens, ...candidate.concreteTokens])
        ).slice(0, 8);

        if (candidate.score > entry.step.score || candidate.concreteTokens.length > entry.step.concreteTokens.length) {
          entry.step = {
            ...candidate,
            startSeconds: earliestSec,
            timestampLabel: earliestTs,
            concreteTokens: mergedConcrete,
          };
          entry.tokens = candTokens;
        } else {
          entry.step.startSeconds = earliestSec;
          entry.step.timestampLabel = earliestTs;
          entry.step.concreteTokens = mergedConcrete;
        }
        merged = true;
        break;
      }
    }

    if (!merged) {
      kept.push({ step: candidate, tokens: candTokens });
    }
  }

  return kept.map((k) => k.step);
}

/**
 * Scores whether a sentence represents a concrete, actionable step (has an action + concrete object).
 */
function scoreCandidateStep(
  rawSentence: string,
  rewritten: string,
  concreteTokens: string[],
  hasDomainConcept: boolean
): number {
  let score = 0;
  const hasImperative = IMPERATIVE_VERB_RE.test(rawSentence) || ACTION_START_RE.test(rewritten);
  const hasOrdinal = ORDINAL_MARKER_RE.test(rawSentence);
  const hasConcrete = concreteTokens.length > 0 || hasDomainConcept;

  if (!hasImperative && !hasOrdinal && concreteTokens.length === 0) return -1;
  if (!hasConcrete && rewritten.length < 36) return -1;

  if (ACTION_START_RE.test(rewritten)) score += 3;
  else if (hasImperative) score += 2;
  if (hasOrdinal) score += 1.5;
  score += Math.min(4, concreteTokens.length * 1.5);
  if (hasDomainConcept) score += 1.5;
  if (/`[^`]+`/.test(rewritten)) score += 2;
  if (/\b(?:prompt|command|file|folder|directory|setting|config|port|ip|subnet|vlan|route|layer|frame|render|export|build|install|package|library|audio|video|mesh|camera|light|model|api|token|schema|table|query)\b/i.test(rewritten)) {
    score += 1.5;
  }

  // Penalize overly conversational or storytelling fragments
  if (/\b(?:my friend|last week|back in \d{4}|i used to|in college|subscribe|channel|thumbnail|patreon|sponsor)\b/i.test(rawSentence)) {
    score -= 4;
  }
  if (/\?$/.test(rewritten) && !hasImperative) {
    score -= 3;
  }

  return score;
}

const DOMAIN_CONCEPT_RE =
  /\b(?:subnet|cidr|ipv4|ipv6|vlan|router|switch|gateway|dhcp|dns|nat|osi\s+layer|tcp|udp|port\s+\d+|ethernet|fiber|cat5e|cat6|wireless|ssid|vpn|firewall|acl|snmp|ssh|tls|proxy|load\s+balancer|keyframe|timeline|codec|fps|audio|sfx|voiceover|caption|font|layout|transition|shader|mesh|camera|lighting|material|texture|orbit|render|export|prompt|skill|markdown|repo|branch|commit|endpoint|schema|middleware|container|image|pod|ingress|binary|symbol|breakpoint|register|stack|heap|string)\b/i;

export function extractStructuredStages(
  sentences: TimedSentence[],
  chapters: RawChapter[],
  sizeMode: SourceSizeMode
): DistilledStage[] {
  if (sentences.length === 0) return [];

  // Determine chapter buckets
  let buckets: Array<{ title: string; startSeconds: number; endSeconds: number }> = [];
  if (chapters.length > 0) {
    buckets = chapters.map((ch, idx) => ({
      title: ch.title,
      startSeconds: ch.startSeconds,
      endSeconds: idx + 1 < chapters.length ? chapters[idx + 1].startSeconds : Number.MAX_SAFE_INTEGER,
    }));
  } else if (sizeMode === 'long' || sentences.length >= 24) {
    // Auto-segment into 3–4 chronological phases
    const minSec = sentences[0].startSeconds;
    const maxSec = Math.max(minSec + 1, sentences[sentences.length - 1].startSeconds);
    const phaseCount = sizeMode === 'long' ? 4 : 3;
    const phaseNames =
      phaseCount === 4
        ? ['Setup & Preparation', 'Core Implementation', 'Refinement & Integration', 'Export & Verification']
        : ['Setup & Inputs', 'Core Execution', 'Output & Verification'];
    const span = (maxSec - minSec) / phaseCount;
    buckets = phaseNames.map((title, idx) => ({
      title,
      startSeconds: Math.floor(minSec + idx * span),
      endSeconds: idx + 1 < phaseCount ? Math.floor(minSec + (idx + 1) * span) : Number.MAX_SAFE_INTEGER,
    }));
  } else {
    buckets = [
      {
        title: 'Core Workflow',
        startSeconds: sentences[0].startSeconds,
        endSeconds: Number.MAX_SAFE_INTEGER,
      },
    ];
  }

  const maxStepsPerBucket = sizeMode === 'long' ? 3 : sizeMode === 'medium' ? 5 : 6;
  const stages: DistilledStage[] = [];
  let recentSubject: string | undefined;

  for (const bucket of buckets) {
    const bucketSentences = sentences.filter(
      (s) => s.startSeconds >= bucket.startSeconds && s.startSeconds < bucket.endSeconds
    );
    if (bucketSentences.length === 0) continue;

    const candidates: StructuredStep[] = [];
    for (const s of bucketSentences) {
      const concreteTokens = extractConcreteTokens(s.text);
      if (concreteTokens.length > 0) {
        recentSubject = concreteTokens[0];
      }
      const resolved = resolveVagueReferences(s.text, bucket.title, recentSubject);
      const rewritten = rewriteToImperativeStep(resolved);
      if (!rewritten || rewritten.length < 18) continue;

      const hasConcept = DOMAIN_CONCEPT_RE.test(rewritten);
      const score = scoreCandidateStep(s.text, rewritten, concreteTokens, hasConcept);
      if (score < 3.0) continue;

      candidates.push({
        action: rewritten,
        timestampLabel: s.timestampLabel,
        startSeconds: s.startSeconds,
        source: 'video',
        chapterTitle: bucket.title,
        concreteTokens,
        score,
      });
    }

    const deduped = deduplicateAndMergeSteps(candidates);
    if (deduped.length === 0) continue;

    // Pick top-scoring steps for SKILL.md, then restore chronological order
    const selected = [...deduped]
      .sort((a, b) => b.score - a.score || a.startSeconds - b.startSeconds)
      .slice(0, maxStepsPerBucket)
      .sort((a, b) => a.startSeconds - b.startSeconds);

    stages.push({
      title: bucket.title,
      startTimestamp: formatSecToMmSs(selected[0]?.startSeconds ?? bucket.startSeconds),
      startSeconds: bucket.startSeconds,
      steps: selected,
      allCandidateSteps: deduped.sort((a, b) => a.startSeconds - b.startSeconds),
    });
  }

  return stages;
}

// --- Caption / Reel / Comment Action Extraction ---

export function extractCaptionWorkflowActions(
  description: string,
  pinnedText: string
): { actions: string[]; dmCtaKeywords: string[]; hashtags: string[] } {
  const combined = `${description || ''}\n${pinnedText || ''}`;
  const dmCtaKeywords: string[] = [];
  const dmRegex =
    /\b(?:(?:comment|reply|dm\s+me)\s+["'“”]?([A-Z0-9_-]{2,20})["'“”]?|type\s+["'“”]([A-Z0-9_-]{2,20})["'“”]\s+(?:below|in\s+the\s+comments|and\s+i))/gi;
  for (const m of combined.matchAll(dmRegex)) {
    const kw = (m[1] || m[2] || '').trim().toUpperCase();
    if (
      kw &&
      !['BELOW', 'HERE', 'THIS', 'THE', 'AND', 'FOR', 'YOUR', 'WITH', 'THAT', 'UNAVAILABLE', 'LINK'].includes(kw)
    ) {
      if (!dmCtaKeywords.includes(kw)) dmCtaKeywords.push(kw);
    }
  }

  const hashtags = extractHashtags(combined);
  const actions: string[] = [];
  const seen = new Set<string>();

  const pushAction = (rawLine: string) => {
    const cleaned = fixAsrTechErrors(
      rawLine
        .replace(/^\s*(?:[-*•→▶✅👉👇📌🔥⚡]|\d+[.)])\s*/, '')
        .replace(/#[a-zA-Z0-9_-]+/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    );
    if (cleaned.length < 14 || cleaned.length > 220) return;
    if (REEL_ENGAGEMENT_BAIT_RE.test(cleaned)) return;
    if (FILLER_OR_CTA_SENTENCE_RE.test(cleaned)) return;
    if (SPONSOR_BLOCK_RE.test(cleaned)) return;
    if (/^https?:\/\/\S+$/i.test(cleaned)) return;

    // Must contain either an action verb, a concrete token, or substantive tool/workflow phrasing
    const concrete = extractConcreteTokens(cleaned);
    const hasSubstance =
      concrete.length > 0 ||
      IMPERATIVE_VERB_RE.test(cleaned) ||
      DOMAIN_CONCEPT_RE.test(cleaned) ||
      /\b(?:library|libraries|pack|template|prompt|sound\s+effects?|motion\s+graphics?|style|workflow|setup|config|step|tool|guide)\b/i.test(
        cleaned
      );
    if (!hasSubstance) return;

    // Strip casual teaser fragments like "most people skip:" while preserving the substantive payload!
    const strippedTeaser = cleaned
      .replace(/^the\s+\d+\s+(?:libraries|tools|steps|things)\s+(?:most\s+people|everyone)\s+skip\s*[:\-–—]?\s*/i, 'Include ')
      .replace(/^(?:here'?s|this\s+is)\s+(?:the\s+|how\s+(?:to|i)\s+)?/i, '')
      .trim();

    const finalStep = rewriteToImperativeStep(strippedTeaser || cleaned);
    if (!finalStep || finalStep.length < 14) return;
    const key = finalStep.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    actions.push(finalStep);
  };

  for (const line of combined.split(/\r?\n/)) {
    // Split multi-sentence lines if long
    if (line.length > 180) {
      for (const part of line.split(/(?<=[.!?])\s+/)) {
        pushAction(part);
      }
    } else {
      pushAction(line);
    }
  }

  return { actions: actions.slice(0, 8), dmCtaKeywords, hashtags };
}

// --- Real Pitfall Extraction (Low False Positives) ---

const PITFALL_SIGNAL_RE =
  /\b(?:avoid\s+\w+|never\s+(?:run|use|put|strip|rebase|delete|commit|push|hardcode|expose|forget|skip)|make\s+sure\s+(?:not\s+to|you\s+don['’]?t)|do\s+not\s+(?:run|use|strip|rebase|delete|forget|skip)|be\s+careful\s+(?:not\s+to|with|when)|gotcha|warning|pitfall|common\s+mistake|fails?\s+(?:when|if)|won['’]?t\s+work\s+(?:if|unless)|doesn['’]?t\s+(?:support|work\s+with)|not\s+supported|file\s+type\s+(?:was\s+|is\s+)?unavailable|unsupported\s+file|weekly\s+limit|rate\s+limit|error\s+when|will\s+break|breaks?\s+if|don['’]?t\s+forget\s+to)\b/i;

const PITFALL_FALSE_POSITIVE_RE =
  /\b(?:don'?t\s+need\s+(?:to\s+know\s+)?(?:coding|after\s+effects|blender|experience)|without\s+(?:knowing|coding|after\s+effects)|watch\s+(?:my|this)\s+.{0,30}\s+video|like\s+and\s+subscribe|comment\s+below|instead\s+of\s+watching)\b/i;

export function extractPitfallsAndGotchas(
  sentences: TimedSentence[],
  pinnedText: string,
  description: string
): ExtractedPitfall[] {
  const pitfalls: ExtractedPitfall[] = [];
  const seen = new Set<string>();

  const pushPitfall = (
    raw: string,
    source: 'transcript' | 'pinned_comment' | 'description',
    timestampLabel?: string
  ) => {
    const clean = fixAsrTechErrors(raw).replace(/\s+/g, ' ').trim();
    if (clean.length < 22 || clean.length > 220) return;
    if (!PITFALL_SIGNAL_RE.test(clean)) return;
    if (PITFALL_FALSE_POSITIVE_RE.test(clean)) return;
    if (FILLER_OR_CTA_SENTENCE_RE.test(clean)) return;
    if (REEL_ENGAGEMENT_BAIT_RE.test(clean)) return;

    const normalized = rewriteToImperativeStep(clean);
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    pitfalls.push({ text: normalized, source, timestampLabel });
  };

  for (const line of pinnedText.split(/\r?\n|(?<=[.!?])\s+/)) {
    pushPitfall(line, 'pinned_comment');
  }
  for (const line of description.split(/\r?\n/)) {
    pushPitfall(line, 'description');
  }
  for (const s of sentences) {
    pushPitfall(s.text, 'transcript', s.timestampLabel);
  }

  return pitfalls.slice(0, 8);
}

// --- Visual Blindspot Detection ---

const VISUAL_BLINDSPOT_RE =
  /\b(as\s+you\s+can\s+see|look\s+at\s+(?:this|my\s+screen|the\s+screen)|right\s+here\s+on\s+(?:the\s+)?screen|click\s+(?:this|that)\s+(?:button|icon|tab)|just\s+built\s+this|minutes?\s+later[.,…\s]+this|look\s+how\s+(?:it|this)|on\s+screen\s+right\s+now|these\s+exact\s+settings|copy\s+these\s+settings)\b/i;

export function detectVisualBlindspots(sentences: TimedSentence[]): VisualBlindspot[] {
  const out: VisualBlindspot[] = [];
  const seenTs = new Set<string>();
  for (const s of sentences) {
    const m = s.text.match(VISUAL_BLINDSPOT_RE);
    if (!m) continue;
    if (seenTs.has(s.timestampLabel)) continue;
    seenTs.add(s.timestampLabel);
    out.push({
      timestampLabel: s.timestampLabel,
      phrase: m[1],
      context: s.text.slice(0, 140),
    });
    if (out.length >= 10) break;
  }
  return out;
}

// --- Source Size & Coverage Classification ---

export function classifySourceSize(
  platform: SkillSourcePlatform,
  durationSeconds: number,
  chapterCount: number,
  segmentCount: number
): SourceSizeMode {
  if (platform === 'instagram') return 'reel';
  if (platform === 'twitter') {
    if (durationSeconds >= 720 || segmentCount >= 35) return 'long';
    if (durationSeconds > 180 || segmentCount >= 8) return 'medium';
    return 'short';
  }
  if (durationSeconds >= 720 || chapterCount >= 6 || segmentCount >= 120) return 'long';
  if (durationSeconds > 240 || segmentCount >= 28) return 'medium';
  return 'short';
}

export function computeCoverageLevel(params: {
  platform: SkillSourcePlatform;
  segmentCount: number;
  stageStepCount: number;
  captionActionCount: number;
  artifactCount: number;
  blindspotCount: number;
  frameCount: number;
  hasAudio: boolean;
}): CoverageLevel {
  const {
    platform,
    segmentCount,
    stageStepCount,
    captionActionCount,
    artifactCount,
    blindspotCount,
    frameCount,
    hasAudio,
  } = params;

  if (platform === 'instagram') {
    if (segmentCount > 0 || hasAudio || (captionActionCount >= 2 && frameCount >= 2)) {
      return 'MODERATE';
    }
    if (captionActionCount >= 2 || artifactCount >= 1) {
      return 'MODERATE';
    }
    return 'VISUAL_HEAVY_NEEDS_FRAMES';
  }

  if (platform === 'twitter') {
    if (segmentCount >= 6 && (stageStepCount >= 3 || artifactCount >= 1)) {
      return 'RICH';
    }
    if (segmentCount >= 1 || captionActionCount >= 1 || artifactCount >= 1 || hasAudio || frameCount >= 1) {
      return 'MODERATE';
    }
    return 'VISUAL_HEAVY_NEEDS_FRAMES';
  }

  if (segmentCount === 0) {
    return captionActionCount >= 2 && frameCount >= 2 ? 'MODERATE' : 'VISUAL_HEAVY_NEEDS_FRAMES';
  }
  if (blindspotCount >= 4 && frameCount === 0 && stageStepCount < 5) {
    return 'VISUAL_HEAVY_NEEDS_FRAMES';
  }
  if ((stageStepCount >= 4 || (stageStepCount >= 2 && artifactCount >= 2)) && (artifactCount >= 1 || segmentCount >= 20)) {
    return 'RICH';
  }
  return 'MODERATE';
}

// --- Master Distillation Entrypoint ---

export interface DistilledVideoInput {
  sourcePlatform?: SkillSourcePlatform;
  videoId: string;
  title: string;
  channelName: string;
  durationSeconds?: number;
  pageUrl: string;
  description?: string;
  pinnedComment?: RawPinnedComment;
  labeledLinks?: RawLabeledLink[];
  chapters?: RawChapter[];
  transcriptSegments?: RawTranscriptSegment[];
  capturedFrameCount?: number;
  hasAudio?: boolean;
}

export interface DistilledVideoAnalysis {
  platform: SkillSourcePlatform;
  sizeMode: SourceSizeMode;
  cleanTitle: string;
  rawTitle: string;
  cleanChannel: string;
  cleanDescription: string;
  cleanPinnedText: string;
  domain: string;
  detectedTools: string[];
  excludedTools: string[];
  detectedVersions: string[];
  usefulLinks: RawLabeledLink[];
  hashtags: string[];
  dmCtaKeywords: string[];
  chapters: RawChapter[];
  sentences: TimedSentence[];
  stages: DistilledStage[];
  captionActions: string[];
  artifacts: ExtractedArtifact[];
  pitfalls: ExtractedPitfall[];
  blindspots: VisualBlindspot[];
  coverageLevel: CoverageLevel;
  securityFlagsCount: number;
}

export function distillVideoSource(input: DistilledVideoInput): DistilledVideoAnalysis {
  const platform: SkillSourcePlatform =
    input.sourcePlatform === 'instagram'
      ? 'instagram'
      : input.sourcePlatform === 'twitter'
        ? 'twitter'
        : 'youtube';

  const fallbackChannel =
    platform === 'instagram'
      ? '@instagram-creator'
      : platform === 'twitter'
        ? '@x-creator'
        : 'Unknown Creator';
  const titleSan = sanitizeUntrustedText(input.title || '');
  const channelSan = sanitizeUntrustedText(input.channelName || fallbackChannel);
  const descSan = sanitizeUntrustedText(input.description || '');
  const pinnedSan = sanitizeUntrustedText(input.pinnedComment?.text || '');

  let securityFlagsCount = titleSan.flagsCount + channelSan.flagsCount + descSan.flagsCount + pinnedSan.flagsCount;

  const cleanDescription = cleanDescriptionText(descSan.text);
  const cleanPinnedText = fixAsrTechErrors(pinnedSan.text).trim();

  const sanitizedSegments: RawTranscriptSegment[] = (input.transcriptSegments || []).map((seg) => {
    const s = sanitizeUntrustedText(seg.text || '');
    securityFlagsCount += s.flagsCount;
    return { ...seg, text: s.text };
  });

  const sentences = buildCleanTimedSentences(sanitizedSegments);
  const chapters = mergeAndDedupeChapters(input.chapters || [], cleanDescription);

  const durationSeconds = Number(input.durationSeconds || 0);
  const { tools: detectedTools, excludedTools } = detectToolsWithNegation(
    titleSan.text,
    cleanDescription,
    cleanPinnedText,
    sentences,
    durationSeconds
  );

  const transcriptSample = sentences.map((s) => s.text).join(' ');
  const domain = detectDomain(titleSan.text, cleanDescription, transcriptSample, detectedTools);
  const cleanTitle = cleanSkillTitle(titleSan.text, domain, detectedTools);
  const sizeMode = classifySourceSize(platform, durationSeconds, chapters.length, sanitizedSegments.length);

  const stages = extractStructuredStages(sentences, chapters, sizeMode);
  const { actions: captionActions, dmCtaKeywords, hashtags } = extractCaptionWorkflowActions(
    cleanDescription,
    cleanPinnedText
  );
  const artifacts = extractCodeAndPromptArtifacts(
    cleanDescription,
    cleanPinnedText,
    sentences,
    platform === 'instagram' || platform === 'twitter'
  );
  const pitfalls = extractPitfallsAndGotchas(sentences, cleanPinnedText, cleanDescription);
  const blindspots = detectVisualBlindspots(sentences);
  const usefulLinks = extractUsefulLinks(input.labeledLinks || [], cleanDescription, cleanPinnedText);
  const detectedVersions = extractVersionsFromSource(
    `${cleanTitle}\n${cleanDescription}\n${cleanPinnedText}\n${transcriptSample.slice(0, 8000)}`
  );

  const stageStepCount = stages.reduce((acc, st) => acc + st.steps.length, 0);
  const coverageLevel = computeCoverageLevel({
    platform,
    segmentCount: sanitizedSegments.length,
    stageStepCount,
    captionActionCount: captionActions.length,
    artifactCount: artifacts.length,
    blindspotCount: blindspots.length,
    frameCount: input.capturedFrameCount || 0,
    hasAudio: Boolean(input.hasAudio),
  });

  return {
    platform,
    sizeMode,
    cleanTitle,
    rawTitle: titleSan.text.trim(),
    cleanChannel: channelSan.text.trim() || 'Unknown Creator',
    cleanDescription,
    cleanPinnedText,
    domain,
    detectedTools,
    excludedTools,
    detectedVersions,
    usefulLinks,
    hashtags,
    dmCtaKeywords,
    chapters,
    sentences,
    stages,
    captionActions,
    artifacts,
    pitfalls,
    blindspots,
    coverageLevel,
    securityFlagsCount,
  };
}
