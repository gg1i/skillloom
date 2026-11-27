/**
 * Pure-Browser Multi-Provider AI Skill Distillation Engine (Zero SkillLoom Cloud Servers)
 * Supports local runtimes (Ollama, LM Studio) and user-supplied BYOK keys
 * (Gemini Free Tier, OpenRouter, Groq, OpenAI) stored strictly in chrome.storage.local.
 */
import {
  buildZipUint8Array,
  type BrowserGeneratedSkillPackage,
} from './browser-skill-builder';
import { sanitizeUntrustedText, type SkillOutputMode } from './skill-distiller';
import {
  annotateDraftSkillMarkdown,
  buildQualityRepairPrompt,
  evaluateSkillQualityGate,
} from './skill-quality-gate';

export type AiProviderId =
  | 'none'
  | 'ollama'
  | 'lm_studio'
  | 'gemini'
  | 'openrouter'
  | 'groq'
  | 'openai';

export interface AiEngineConfig {
  provider: AiProviderId;
  model: string;
  endpointUrl: string;
  apiKey: string;
  autoDistillOnExport: boolean;
}

export const DEFAULT_AI_CONFIG: AiEngineConfig = {
  provider: 'none',
  model: '',
  endpointUrl: 'http://127.0.0.1:11434',
  apiKey: '',
  autoDistillOnExport: true,
};

export interface ProviderPreset {
  id: AiProviderId;
  label: string;
  defaultEndpoint: string;
  defaultModel: string;
  requiresKey: boolean;
  isLocal: boolean;
  originPermission: string | null;
}

export const AI_PROVIDER_PRESETS: Record<AiProviderId, ProviderPreset> = {
  none: {
    id: 'none',
    label: 'Off (Fast Deterministic Draft)',
    defaultEndpoint: '',
    defaultModel: '',
    requiresKey: false,
    isLocal: true,
    originPermission: null,
  },
  ollama: {
    id: 'ollama',
    label: 'Ollama (Local $0 Offline)',
    defaultEndpoint: 'http://127.0.0.1:11434',
    defaultModel: 'qwen2.5:7b',
    requiresKey: false,
    isLocal: true,
    originPermission: 'http://127.0.0.1/*',
  },
  lm_studio: {
    id: 'lm_studio',
    label: 'LM Studio (Local $0 OpenAI API)',
    defaultEndpoint: 'http://127.0.0.1:1234',
    defaultModel: 'local-model',
    requiresKey: false,
    isLocal: true,
    originPermission: 'http://127.0.0.1/*',
  },
  gemini: {
    id: 'gemini',
    label: 'Google Gemini (Free Audio+Vision BYOK)',
    defaultEndpoint: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-flash-latest',
    requiresKey: true,
    isLocal: false,
    originPermission: 'https://generativelanguage.googleapis.com/*',
  },
  openrouter: {
    id: 'openrouter',
    label: 'OpenRouter (:free / BYOK Key)',
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    defaultModel: 'openrouter/free',
    requiresKey: true,
    isLocal: false,
    originPermission: 'https://openrouter.ai/*',
  },
  groq: {
    id: 'groq',
    label: 'Groq (Whisper Audio + Fast LLM BYOK)',
    defaultEndpoint: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    requiresKey: true,
    isLocal: false,
    originPermission: 'https://api.groq.com/*',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI (BYOK Key)',
    defaultEndpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    requiresKey: true,
    isLocal: false,
    originPermission: 'https://api.openai.com/*',
  },
};

export function isLoopbackEndpoint(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      (parsed.hostname === '127.0.0.1' ||
        parsed.hostname === 'localhost' ||
        parsed.hostname === '::1')
    );
  } catch {
    return false;
  }
}

export function isVisionCapableModelName(name: string): boolean {
  return /\b(?:llava|qwen[\d.]*-?vl|llama-?(?:\d+\.)?\d*-?(?:vision|scout|maverick)|minicpm-v|moondream|gemma-?3|gemini-|gpt-4o|pixtral|vision)\b/i.test(
    name
  );
}

interface CanonicalSectionDef {
  heading: string;
  exactRe: RegExp;
  aliasRe?: RegExp;
  defaultBody: string;
}

const CANONICAL_SECTIONS_BY_MODE: Record<SkillOutputMode, CanonicalSectionDef[]> = {
  agent: [
    {
      heading: '## When to use',
      exactRe: /^##\s+When to use\b/im,
      aliasRe: /^##\s+(?:Where\s+This\s+Skill\s+Helps\s+Most|Use\s+Cases?)\b[^\r\n]*/im,
      defaultBody: '- Use when following this tutorial workflow end to end. `[Added — not from video]`',
    },
    {
      heading: '## Prerequisites',
      exactRe: /^##\s+Prerequisites\b/im,
      aliasRe: /^##\s+(?:Requirements|Before\s+You\s+Start|Setup)\b[^\r\n]*/im,
      defaultBody: '- Confirm required tools and permissions before starting. `[Added — not from video]`',
    },
    {
      heading: '## Steps',
      exactRe: /^##\s+Steps\b/im,
      aliasRe: /^##\s+(?:Procedural\s+Workflow|Procedure|Workflow|Instructions)\b[^\r\n]*/im,
      defaultBody: '1. Review the captured workflow steps in `references/source-evidence.md`. `[Added — not from video]`',
    },
    {
      heading: '## Verify it worked',
      exactRe: /^##\s+Verify it worked\b/im,
      aliasRe: /^##\s+(?:Verification|Checks?|Testing)\b[^\r\n]*/im,
      defaultBody: '- Confirm expected outputs match each completed step without errors. `[Added — not from video]`',
    },
    {
      heading: '## Common mistakes / troubleshooting',
      exactRe: /^##\s+Common mistakes\s*\/\s*troubleshooting\b/im,
      aliasRe: /^##\s+(?:Common mistakes|Troubleshooting|Pitfalls)\b[^\r\n]*/im,
      defaultBody: '- Re-check prerequisites and exact CLI arguments if a step fails. `[Added — not from video]`',
    },
    {
      heading: '## Added context (not from the video)',
      exactRe: /^##\s+Added context\s*\(not from the video\)/im,
      aliasRe: /^##\s+Added\s+context\b[^\r\n]*/im,
      defaultBody: '- Generic safety and verification practices marked `[Added — not from video]` supplement the captured tutorial.',
    },
    {
      heading: '## Source and limitations',
      exactRe: /^##\s+Source and limitations\b/im,
      aliasRe: /^##\s+Sources?(?:\s*(?:&|and)\s*limitations)?\b[^\r\n]*/im,
      defaultBody: '- Source metadata and evidence are recorded in `references/source-evidence.md`.',
    },
  ],
  study: [
    {
      heading: '## Big Picture & Learning Objectives',
      exactRe: /^##\s+Big Picture\s*&\s*Learning Objectives\b/im,
      aliasRe: /^##\s+(?:Big\s+Picture|Overview|Learning\s+Objectives|Summary)\b[^\r\n]*/im,
      defaultBody: '- Understand the core goal and mental model of this topic. `[Added — not from video]`',
    },
    {
      heading: '## Key Concepts & Definitions',
      exactRe: /^##\s+Key Concepts\s*&\s*Definitions\b/im,
      aliasRe: /^##\s+(?:Key\s+Concepts|Definitions|Vocabulary|Prerequisites)\b[^\r\n]*/im,
      defaultBody: '- Review core terms and definitions listed in `references/source-evidence.md`. `[Added — not from video]`',
    },
    {
      heading: '## Core Notes & Walkthrough',
      exactRe: /^##\s+Core Notes\s*&\s*Walkthrough\b/im,
      aliasRe: /^##\s+(?:Core\s+Notes|Study\s+Notes|Walkthrough|Notes)\b[^\r\n]*/im,
      defaultBody: '1. Review key timeline points in `references/source-evidence.md`. `[Added — not from video]`',
    },
    {
      heading: '## Worked Examples & Takeaways',
      exactRe: /^##\s+Worked Examples\s*&\s*Takeaways\b/im,
      aliasRe: /^##\s+(?:Worked\s+Examples|Examples|Key\s+Takeaways)\b[^\r\n]*/im,
      defaultBody: '- Summarize one concrete example from the source without looking at notes. `[Added — not from video]`',
    },
    {
      heading: '## Active Recall Questions',
      exactRe: /^##\s+Active Recall Questions\b/im,
      aliasRe: /^##\s+(?:Active\s+Recall|Practice\s+Questions|Self[\s-]Test|Flashcards|Quiz)\b[^\r\n]*/im,
      defaultBody: '1. **Q: What are the key takeaways and why do they matter?**\n   **Answer:** Review Core Notes & Walkthrough.',
    },
    {
      heading: '## Exam Traps & Common Mistakes',
      exactRe: /^##\s+Exam Traps\s*&\s*Common Mistakes\b/im,
      aliasRe: /^##\s+(?:Exam\s+Traps|Common\s+Mistakes|Pitfalls|Misconceptions)\b[^\r\n]*/im,
      defaultBody: '- Double-check boundary conditions and prerequisites before relying on memorized steps. `[Added — not from video]`',
    },
    {
      heading: '## Source & Further Review',
      exactRe: /^##\s+Source\s*&\s*Further Review\b/im,
      aliasRe: /^##\s+Sources?(?:\s*(?:&|and)\s*(?:limitations|review|further\s+review))?\b[^\r\n]*/im,
      defaultBody: '- Source metadata and evidence are recorded in `references/source-evidence.md`.',
    },
  ],
};

function extractCanonicalSectionFromMarkdown(markdown: string, exactRe: RegExp): string {
  const m = exactRe.exec(markdown);
  if (!m) return '';
  const bodyStart = m.index + m[0].length;
  const rest = markdown.slice(bodyStart);
  const nextH2 = rest.search(/\r?\n##\s+/);
  let body = (nextH2 === -1 ? rest : rest.slice(0, nextH2)).trim();
  // Strip any prior draft refinement checklist before carrying Source section forward
  body = body
    .replace(/\r?\n###\s+(?:Agent|Study) refinement checklist\s*\(missing from source\)[\s\S]*$/i, '')
    .trim();
  return body;
}

function insertBeforeSourceOrAppend(
  markdown: string,
  block: string,
  outputMode: SkillOutputMode
): string {
  const srcRe =
    outputMode === 'study'
      ? /\r?\n##\s+Source\s*&\s*Further Review\b/im
      : /\r?\n##\s+Source and limitations\b/im;
  const srcMatch = srcRe.exec(markdown);
  if (!srcMatch) {
    return `${markdown.trimEnd()}\n\n${block}`;
  }
  const before = markdown.slice(0, srcMatch.index).trimEnd();
  const after = markdown.slice(srcMatch.index).trimStart();
  return `${before}\n\n${block}\n\n${after}`;
}

/**
 * Unwraps markdown code fences if an LLM wrapped its response, ensures valid JSON-quoted
 * YAML frontmatter (`name`, `description`), and normalizes heading titles for the active mode.
 */
export function normalizeAndRepairSkillMarkdown(
  rawLlmOutput: string,
  fallbackPkg: BrowserGeneratedSkillPackage
): string {
  const mode: SkillOutputMode = fallbackPkg.outputMode || 'agent';
  let text = rawLlmOutput.trim();
  const fenced = text.match(/^```(?:markdown|md)?\r?\n([\s\S]*?)\r?\n```$/i);
  if (fenced) {
    text = fenced[1].trim();
  }

  const sanitized = sanitizeUntrustedText(text);
  text = sanitized.text;

  if (!/^---\r?\n[\s\S]*?\r?\n---/.test(text)) {
    const draftFm = fallbackPkg.files[0]?.content.match(/^---\r?\n[\s\S]*?\r?\n---/)?.[0];
    if (draftFm) {
      text = `${draftFm}\n\n${text}`;
    }
  } else {
    text = text.replace(/^---\r?\n([\s\S]*?)\r?\n---/, (_full, fmBody: string) => {
      let fixedBody = fmBody;
      if (!/^name:\s*\S+/m.test(fixedBody)) {
        fixedBody = `name: ${fallbackPkg.slug}\n${fixedBody}`;
      }
      const descLineMatch = fixedBody.match(/^description:\s*(.+)$/m);
      if (!descLineMatch) {
        fixedBody = `${fixedBody}\ndescription: ${JSON.stringify(fallbackPkg.title)}`;
      } else {
        const rawDesc = descLineMatch[1].trim();
        if (rawDesc.startsWith('"')) {
          try {
            JSON.parse(rawDesc);
          } catch {
            const inner = rawDesc.replace(/^"+|"+$/g, '').replace(/[\r\n]+/g, ' ').trim();
            fixedBody = fixedBody.replace(
              /^description:\s*.+$/m,
              `description: ${JSON.stringify(inner || fallbackPkg.title)}`
            );
          }
        }
      }
      return `---\n${fixedBody.trim()}\n---`;
    });
  }

  if (!/^#\s+\S+/m.test(text)) {
    const fallbackH1 =
      mode === 'study'
        ? `# Study Notes: ${fallbackPkg.title || fallbackPkg.slug}`
        : `# ${fallbackPkg.title || fallbackPkg.slug}`;
    text = text.replace(/^(---\r?\n[\s\S]*?\r?\n---)/, `$1\n\n${fallbackH1}`);
  }

  for (const sec of CANONICAL_SECTIONS_BY_MODE[mode]) {
    if (!sec.exactRe.test(text) && sec.aliasRe && sec.aliasRe.test(text)) {
      text = text.replace(sec.aliasRe, sec.heading);
    }
  }

  return `${text.trim()}\n`;
}

/**
 * Restores any required section omitted by an LLM from the verified deterministic
 * package so fast/compact models (Groq, OpenRouter, Ollama) never get blocked post-repair.
 */
export function restoreMissingSkillSections(
  rawSkillMd: string,
  fallbackPkg: BrowserGeneratedSkillPackage
): string {
  const mode: SkillOutputMode = fallbackPkg.outputMode || 'agent';
  const sections = CANONICAL_SECTIONS_BY_MODE[mode];
  const lastHeading = sections[sections.length - 1].heading;
  let text = rawSkillMd.trim();
  const fallbackSkillMd = fallbackPkg.files[0]?.content || '';

  for (const sec of sections) {
    if (!sec.exactRe.test(text) && sec.aliasRe && sec.aliasRe.test(text)) {
      text = text.replace(sec.aliasRe, sec.heading);
    }
    if (!sec.exactRe.test(text)) {
      const fallbackBody =
        extractCanonicalSectionFromMarkdown(fallbackSkillMd, sec.exactRe) || sec.defaultBody;
      const sectionBlock = `${sec.heading}\n\n${fallbackBody}`;
      if (sec.heading === lastHeading) {
        text = `${text.trimEnd()}\n\n${sectionBlock}`;
      } else {
        text = insertBeforeSourceOrAppend(text, sectionBlock, mode);
      }
    }
  }

  return `${text.trim()}\n`;
}

export function applyRefinedSkillMarkdown(
  pkg: BrowserGeneratedSkillPackage,
  refinedSkillMd: string,
  audioTranscriptText?: string,
  transcriptHeading = 'Spoken Audio Transcript (BYOK Whisper)'
): BrowserGeneratedSkillPackage {
  const outputMode: SkillOutputMode = pkg.outputMode || 'agent';
  const primaryFilename = pkg.primaryFilename || (outputMode === 'study' ? 'NOTES.md' : 'SKILL.md');
  const cleanTranscript = audioTranscriptText
    ? sanitizeUntrustedText(audioTranscriptText).text.trim()
    : '';

  const buildUpdated = (skillContent: string) =>
    pkg.files.map((f, idx) => {
      if (idx === 0 && (f.relativePath === 'SKILL.md' || f.relativePath === 'NOTES.md')) {
        return { ...f, relativePath: primaryFilename, content: skillContent };
      }
      if (cleanTranscript && f.relativePath === 'references/source-evidence.md') {
        return {
          ...f,
          content: `${f.content.trimEnd()}\n\n## ${transcriptHeading}\n${cleanTranscript}\n`,
        };
      }
      return f;
    });

  let finalFiles = buildUpdated(refinedSkillMd);
  const qualityReport = evaluateSkillQualityGate(finalFiles, pkg.sizeMode, outputMode);
  if (qualityReport.grade === 'DRAFT') {
    const annotated = annotateDraftSkillMarkdown(refinedSkillMd, qualityReport, outputMode);
    finalFiles = buildUpdated(annotated);
  }

  const zipBytes = buildZipUint8Array(
    finalFiles.map((f) => ({
      archivePath: `${pkg.slug}/${f.relativePath}`,
      content: f.binaryBytes ?? f.content,
    }))
  );

  return {
    ...pkg,
    qualityReport,
    files: finalFiles,
    zipBytes,
    agentEvalPrompt: [
      outputMode === 'study'
        ? `Save or study these AI-enriched SkillLoom Study Notes ("${pkg.slug}", quality score: ${qualityReport.score}/100, status: ${qualityReport.grade}) in your Study Vault or ask your assistant to quiz you on weak areas.`
        : `Install or refine this AI-enriched SkillLoom skill ("${pkg.slug}", quality score: ${qualityReport.score}/100, status: ${qualityReport.grade}) into your local agent skills directory (e.g. \`~/.gemini/config/skills/${pkg.slug}/\` or \`.claude/skills/${pkg.slug}/\`).`,
      ...(qualityReport.gaps.length > 0
        ? ['', 'Quality gate notes:', ...qualityReport.gaps.map((g) => `- ${g}`)]
        : []),
      '',
      ...finalFiles
        .filter((f) => !f.binaryBytes)
        .map((f) => `=== FILE: ${pkg.slug}/${f.relativePath} ===\n\n${f.content}`),
    ].join('\n\n'),
  };
}

export async function probeOllamaLocalModels(
  endpointUrl = 'http://127.0.0.1:11434',
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  if (!isLoopbackEndpoint(endpointUrl)) return [];
  const base = endpointUrl.replace(/\/+$/, '');
  try {
    const res = await fetchImpl(`${base}/api/tags`, { signal: AbortSignal.timeout(1800) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    return (data.models || []).map((m) => String(m.name || '')).filter(Boolean);
  } catch {
    return [];
  }
}

async function transcribeAudioWithWhisper(
  endpoint: string,
  apiKey: string,
  provider: 'groq' | 'openai',
  audioBase64: string,
  mimeType: string,
  fetchImpl: typeof fetch
): Promise<string> {
  const raw = atob(audioBase64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    bytes[i] = raw.charCodeAt(i);
  }
  const cleanMime = mimeType || 'audio/webm';
  const ext = cleanMime.includes('mp4') ? 'm4a' : cleanMime.includes('wav') ? 'wav' : 'webm';
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: cleanMime }), `reel-audio.${ext}`);
  form.append('model', provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1');

  const transcribeUrl = endpoint.endsWith('/v1')
    ? `${endpoint}/audio/transcriptions`
    : `${endpoint}/v1/audio/transcriptions`;
  const res = await fetchImpl(transcribeUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`${provider} Whisper transcription failed (${res.status}).`);
  }
  const data = (await res.json()) as { text?: string };
  return (data.text || '').trim();
}

const CURATED_GEMINI_FALLBACKS = [
  'gemini-flash-latest',
  'gemini-flash-lite-latest',
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-4-hydrogen',
  'gemma-3-27b-it',
  'gemma-3-12b-it',
];

const CURATED_GROQ_FALLBACKS = [
  'llama-3.3-70b-versatile',
  'meta-llama/llama-4-scout-17b-16e-instruct',
  'openai/gpt-oss-120b',
  'qwen/qwen3-32b',
  'llama-3.1-8b-instant',
  'openai/gpt-oss-20b',
  'groq/compound',
];

const CURATED_OPENROUTER_FALLBACKS = ['openrouter/free'];

const CURATED_OPENAI_FALLBACKS = [
  'gpt-4o-mini',
  'gpt-4.1-mini',
  'gpt-4.1-nano',
  'gpt-5-mini',
  'gpt-4o',
];

const NON_CHAT_OPENAI_MODEL_RE =
  /\b(?:whisper|distil-whisper|playai-tts|orpheus|guard|prompt-guard|safeguard|embed|embedding|tts|dall-e|sora|realtime|transcribe|moderation|audio-preview|instruct|babbage|davinci|curie|ada|codex|deep-research|search)\b/i;

function scoreGroqChatModel(id: string, hasFrames: boolean): number {
  const visionBoost = hasFrames && isVisionCapableModelName(id) ? 25 : 0;
  if (/^llama-3\.3-70b-versatile$/i.test(id)) return 120 + visionBoost;
  if (/^meta-llama\/llama-4-(?:scout|maverick)/i.test(id)) return 115 + visionBoost;
  if (/^openai\/gpt-oss-120b$/i.test(id)) return 110 + visionBoost;
  if (/^qwen\/qwen3(?:\.\d+)?-/i.test(id)) return 105 + visionBoost;
  if (/^moonshotai\/kimi-/i.test(id)) return 100 + visionBoost;
  if (/^openai\/gpt-oss-20b$/i.test(id)) return 95 + visionBoost;
  if (/^llama-3\.1-8b-instant$/i.test(id)) return 90 + visionBoost;
  if (/^groq\/compound(?:-mini)?$/i.test(id)) return 80 + visionBoost;
  return 50 + visionBoost;
}

function scoreOpenAiChatModel(id: string): number {
  if (/^gpt-4o-mini$/i.test(id)) return 120;
  if (/^gpt-4\.1-mini$/i.test(id)) return 115;
  if (/^gpt-4\.1-nano$/i.test(id)) return 110;
  if (/^gpt-5-mini$/i.test(id)) return 105;
  if (/^gpt-5-nano$/i.test(id)) return 100;
  if (/^gpt-4o$/i.test(id)) return 95;
  if (/^gpt-4\.1$/i.test(id)) return 90;
  if (/^gpt-5$/i.test(id)) return 85;
  if (/^o4-mini/i.test(id)) return 80;
  if (/^o3-mini/i.test(id)) return 75;
  if (/^gpt-4o-/i.test(id)) return 65;
  if (/(?:-pro|preview)/i.test(id)) return 25;
  return 50;
}

function scoreOpenRouterFreeModel(
  id: string,
  hasFrames: boolean,
  supportsImageInput: boolean
): number {
  if (id === 'openrouter/free') return 140;
  const visionBoost = hasFrames && (supportsImageInput || isVisionCapableModelName(id)) ? 25 : 0;
  if (/^(?:google|meta-llama|qwen|mistralai|deepseek|nvidia|openai)\//i.test(id)) {
    return 100 + visionBoost;
  }
  return 70 + visionBoost;
}

function buildOpenAiHeaders(provider: AiProviderId, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (provider === 'openrouter') headers['X-Title'] = 'SkillLoom';
  return headers;
}

function buildChatCompletionBody(
  provider: AiProviderId,
  model: string,
  messages: Array<{ role: string; content: unknown }>,
  temperature?: number,
  maxTokens?: number
): string {
  const isOpenAiReasoning = provider === 'openai' && /^(?:o[134](?:-|$)|gpt-5)/i.test(model);
  const payload: Record<string, unknown> = { model, messages };
  if (typeof maxTokens === 'number') {
    if (isOpenAiReasoning) payload.max_completion_tokens = Math.max(16, maxTokens);
    else payload.max_tokens = maxTokens;
  }
  if (typeof temperature === 'number' && !isOpenAiReasoning) {
    payload.temperature = temperature;
  }
  return JSON.stringify(payload);
}

/**
 * Discovers active chat models from any OpenAI-compatible `/models` endpoint
 * (Groq, OpenRouter, OpenAI, LM Studio) so users never fail when defaults are restricted or renamed.
 */
export async function probeOpenAiCompatibleModels(
  apiKey: string,
  endpointUrl: string,
  provider: AiProviderId,
  hasFrames = false,
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  if (!endpointUrl.trim()) return [];
  const base = endpointUrl.replace(/\/+$/, '');
  const modelsUrl = base.endsWith('/v1') ? `${base}/models` : `${base}/v1/models`;
  const headers: Record<string, string> = {};
  if (apiKey.trim()) headers.Authorization = `Bearer ${apiKey.trim()}`;
  if (provider === 'openrouter') headers['X-Title'] = 'SkillLoom';

  try {
    const res = await fetchImpl(modelsUrl, {
      method: 'GET',
      headers,
      ...(fetchImpl === fetch && typeof AbortSignal?.timeout === 'function'
        ? { signal: AbortSignal.timeout(4500) }
        : {}),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      data?: Array<{
        id?: string;
        active?: boolean;
        pricing?: { prompt?: string; completion?: string };
        architecture?: { input_modalities?: string[]; output_modalities?: string[] };
      }>;
    };

    const entries = (data.data || []).filter((m) => {
      if (m.active === false) return false;
      const id = String(m.id || '').trim();
      if (!id || NON_CHAT_OPENAI_MODEL_RE.test(id)) return false;
      if (
        m.architecture?.output_modalities &&
        !m.architecture.output_modalities.includes('text')
      ) {
        return false;
      }
      if (provider === 'openai') {
        return /^(?:gpt-|o[134](?:-|$)|chatgpt-4o)/i.test(id);
      }
      if (provider === 'openrouter') {
        const isZeroCost =
          m.pricing?.prompt === '0' &&
          (m.pricing?.completion === '0' || m.pricing?.completion === undefined);
        return id === 'openrouter/free' || /:free$/i.test(id) || isZeroCost;
      }
      return true;
    });

    if (provider === 'groq') {
      return entries
        .map((m) => String(m.id || '').trim())
        .sort((a, b) => scoreGroqChatModel(b, hasFrames) - scoreGroqChatModel(a, hasFrames));
    }
    if (provider === 'openai') {
      return entries
        .map((m) => String(m.id || '').trim())
        .sort((a, b) => scoreOpenAiChatModel(b) - scoreOpenAiChatModel(a));
    }
    if (provider === 'openrouter') {
      return entries
        .sort((a, b) => {
          const scoreA = scoreOpenRouterFreeModel(
            String(a.id || '').trim(),
            hasFrames,
            Boolean(a.architecture?.input_modalities?.includes('image'))
          );
          const scoreB = scoreOpenRouterFreeModel(
            String(b.id || '').trim(),
            hasFrames,
            Boolean(b.architecture?.input_modalities?.includes('image'))
          );
          return scoreB - scoreA;
        })
        .map((m) => String(m.id || '').trim());
    }
    return entries.map((m) => String(m.id || '').trim());
  } catch {
    return [];
  }
}

function isRetryableModelStatus(status: number): boolean {
  return status === 404 || status === 408 || status === 429 || status >= 500;
}

function resolveProviderEndpoint(preset: ProviderPreset, rawConfig: Partial<AiEngineConfig>): string {
  const rawEndpoint = (rawConfig.endpointUrl || '').trim();
  const base = preset.isLocal
    ? rawEndpoint || preset.defaultEndpoint
    : rawEndpoint.startsWith('https://')
      ? rawEndpoint
      : preset.defaultEndpoint;
  return base.replace(/\/+$/, '');
}

export async function probeGeminiAvailableModels(
  apiKey: string,
  endpointUrl = 'https://generativelanguage.googleapis.com',
  fetchImpl: typeof fetch = fetch
): Promise<string[]> {
  if (!apiKey.trim()) return [];
  const base = endpointUrl.replace(/\/+$/, '');
  try {
    const res = await fetchImpl(
      `${base}/v1beta/models?key=${encodeURIComponent(apiKey.trim())}`,
      { signal: AbortSignal.timeout(4500) }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
    };
    const candidates = (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => String(m.name || '').replace(/^models\//, ''))
      .filter(
        (id) =>
          /^(?:gemini-|gemma-)/i.test(id) &&
          !/embedding|imagen|veo|aqa|tts|native-audio|live|computer-use|robotics|deep-research/i.test(
            id
          )
      );

    const scoreModel = (id: string): number => {
      if (/^gemini-(?:1\.|2\.)/i.test(id)) return 10; // Legacy/retired tiers go last
      if (id === 'gemini-flash-latest') return 120;
      if (id === 'gemini-flash-lite-latest') return 115;
      if (/^gemini-3\.5-flash-lite/i.test(id)) return 110;
      if (/^gemini-4-hydrogen/i.test(id)) return 105;
      if (/^gemini-3\.\d+-flash(?!-lite)/i.test(id)) return 100;
      if (/flash-lite/i.test(id)) return 95;
      if (/flash/i.test(id)) return 90;
      if (/^gemma-3-27b/i.test(id)) return 75;
      if (/^gemma-3-12b/i.test(id)) return 70;
      if (/^gemma-/i.test(id)) return 60;
      if (/^gemini-/i.test(id)) return 50;
      return 30;
    };
    return candidates.sort((a, b) => scoreModel(b) - scoreModel(a));
  } catch {
    return [];
  }
}

async function buildCandidateModelsForProvider(
  provider: AiProviderId,
  requestedModel: string,
  apiKey: string,
  endpoint: string,
  hasFrames: boolean,
  fetchImpl: typeof fetch
): Promise<string[]> {
  const unique = (items: string[]) =>
    items
      .map((m) => m.trim())
      .filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx);

  if (provider === 'gemini') {
    const live = await probeGeminiAvailableModels(apiKey, endpoint, fetchImpl);
    return unique([requestedModel, ...live, ...CURATED_GEMINI_FALLBACKS]).slice(0, 30);
  }
  if (provider === 'ollama') {
    const installed = await probeOllamaLocalModels(endpoint, fetchImpl);
    const sorted = [...installed].sort(
      (a, b) =>
        Number(hasFrames && isVisionCapableModelName(b)) -
        Number(hasFrames && isVisionCapableModelName(a))
    );
    return unique([requestedModel && installed.includes(requestedModel) ? requestedModel : '', ...sorted]);
  }
  if (provider === 'groq') {
    const live = await probeOpenAiCompatibleModels(apiKey, endpoint, 'groq', hasFrames, fetchImpl);
    if (live.length > 0) {
      return unique([
        ...(live.includes(requestedModel) ? [requestedModel] : []),
        ...live,
      ]).slice(0, 20);
    }
    return unique([requestedModel, ...CURATED_GROQ_FALLBACKS]);
  }
  if (provider === 'openrouter') {
    const live = await probeOpenAiCompatibleModels(
      apiKey,
      endpoint,
      'openrouter',
      hasFrames,
      fetchImpl
    );
    const isExplicitPaid =
      Boolean(requestedModel) &&
      requestedModel !== 'openrouter/free' &&
      !/:free$/i.test(requestedModel);
    if (live.length > 0) {
      return unique([
        ...(isExplicitPaid || live.includes(requestedModel) ? [requestedModel] : []),
        ...live,
        ...CURATED_OPENROUTER_FALLBACKS,
      ]).slice(0, 20);
    }
    return unique([requestedModel, ...CURATED_OPENROUTER_FALLBACKS]);
  }
  if (provider === 'openai') {
    const live = await probeOpenAiCompatibleModels(apiKey, endpoint, 'openai', hasFrames, fetchImpl);
    if (live.length > 0) {
      return unique([
        ...(live.includes(requestedModel) ? [requestedModel] : []),
        ...live,
      ]).slice(0, 20);
    }
    return unique([requestedModel, ...CURATED_OPENAI_FALLBACKS]);
  }
  return unique([requestedModel]);
}

async function readApiErrorDetail(res: Response): Promise<string> {
  try {
    const raw = await res.text();
    if (!raw) return `HTTP ${res.status}`;
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    if (parsed?.error?.message) return `HTTP ${res.status}: ${parsed.error.message}`;
    return `HTTP ${res.status}: ${raw.slice(0, 140)}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export interface ModelProbeAttempt {
  model: string;
  ok: boolean;
  detail: string;
}

/**
 * Sequentially probes candidate models for the configured AI provider with a tiny
 * ping request and returns the first responding model so users don't guess IDs.
 */
export async function findWorkingModel(
  rawConfig: Partial<AiEngineConfig>,
  onProgress?: (index: number, total: number, model: string, detail?: string) => void,
  fetchImpl: typeof fetch = fetch
): Promise<{
  ok: boolean;
  model?: string;
  testedCount: number;
  tried: ModelProbeAttempt[];
  error?: string;
}> {
  const provider: AiProviderId = rawConfig.provider || 'none';
  if (provider === 'none') {
    return { ok: false, testedCount: 0, tried: [], error: 'Select an AI provider first.' };
  }
  const preset = AI_PROVIDER_PRESETS[provider];
  const endpoint = resolveProviderEndpoint(preset, rawConfig);
  const apiKey = (rawConfig.apiKey || '').trim();
  const requestedModel = (rawConfig.model || preset.defaultModel).trim();

  if (preset.isLocal && !isLoopbackEndpoint(endpoint)) {
    return {
      ok: false,
      testedCount: 0,
      tried: [],
      error: `Local provider "${provider}" must use a loopback URL (127.0.0.1 or localhost).`,
    };
  }
  if (preset.requiresKey && !apiKey) {
    return {
      ok: false,
      testedCount: 0,
      tried: [],
      error: `Paste your ${preset.label} API key first.`,
    };
  }

  const candidates = await buildCandidateModelsForProvider(
    provider,
    requestedModel,
    apiKey,
    endpoint,
    false,
    fetchImpl
  );
  if (candidates.length === 0) {
    return {
      ok: false,
      testedCount: 0,
      tried: [],
      error:
        provider === 'ollama'
          ? 'Ollama has no pulled models or is offline (run e.g. `ollama pull qwen2.5:7b`).'
          : 'No candidate models available to test.',
    };
  }

  const tried: ModelProbeAttempt[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    onProgress?.(i + 1, candidates.length, candidate, 'Testing...');
    try {
      let res: Response;
      if (provider === 'gemini') {
        res = await fetchImpl(
          `${endpoint}/v1beta/models/${encodeURIComponent(candidate)}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'Reply with only the word OK.' }] }],
            }),
          }
        );
      } else if (provider === 'ollama') {
        res = await fetchImpl(`${endpoint}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: candidate, prompt: 'Reply OK', stream: false }),
        });
      } else {
        const chatUrl = endpoint.endsWith('/v1')
          ? `${endpoint}/chat/completions`
          : `${endpoint}/v1/chat/completions`;
        res = await fetchImpl(chatUrl, {
          method: 'POST',
          headers: buildOpenAiHeaders(provider, apiKey),
          body: buildChatCompletionBody(
            provider,
            candidate,
            [{ role: 'user', content: 'Reply OK' }],
            undefined,
            8
          ),
        });
      }

      if (res.ok) {
        tried.push({ model: candidate, ok: true, detail: '200 OK' });
        onProgress?.(i + 1, candidates.length, candidate, 'OK ✓');
        return { ok: true, model: candidate, testedCount: tried.length, tried };
      }

      const detail = await readApiErrorDetail(res);
      tried.push({ model: candidate, ok: false, detail });
      onProgress?.(i + 1, candidates.length, candidate, detail);

      if (res.status === 401 || res.status === 403 || /api key not valid/i.test(detail)) {
        return {
          ok: false,
          testedCount: tried.length,
          tried,
          error: `Authentication failed (${detail}). Check your API key.`,
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Network error';
      tried.push({ model: candidate, ok: false, detail: msg });
      onProgress?.(i + 1, candidates.length, candidate, msg);
    }
  }

  const last = tried[tried.length - 1];
  const trace = tried
    .slice(0, 6)
    .map((t) => `${t.model}(${t.detail.split(':')[0]})`)
    .join(', ');
  const firstErr = tried[0]?.detail || last?.detail || 'Unknown error';
  const providerHint =
    provider === 'groq' && /404|does not exist|do not have access/i.test(firstErr)
      ? ' Tip: check console.groq.com -> Settings -> Limits/Model Permissions to enable chat models for this key.'
      : provider === 'openrouter' && /404|unavailable for free|no endpoints/i.test(firstErr)
        ? ' Tip: use "openrouter/free" for automatic $0 routing or check openrouter.ai/models for active slugs.'
        : provider === 'openai' && /404|does not exist|do not have access/i.test(firstErr)
          ? ' Tip: verify project model access at platform.openai.com/settings/organization/limits.'
          : '';
  return {
    ok: false,
    testedCount: tried.length,
    tried,
    error: `Tested ${tried.length} model(s) [${trace}${tried.length > 6 ? ', ...' : ''}]. First error: ${firstErr}.${providerHint}`,
  };
}

export async function distillSkillWithAiEngine(
  pkg: BrowserGeneratedSkillPackage,
  rawConfig: Partial<AiEngineConfig>,
  fetchImpl: typeof fetch = fetch,
  onProgress?: (status: string) => void
): Promise<{
  pkg: BrowserGeneratedSkillPackage;
  distilled: boolean;
  providerUsed: AiProviderId;
  modelUsed?: string;
  usedVisionFrames: number;
  usedAudio: boolean;
  note?: string;
}> {
  const provider: AiProviderId = rawConfig.provider || 'none';
  if (provider === 'none') {
    return { pkg, distilled: false, providerUsed: 'none', usedVisionFrames: 0, usedAudio: false };
  }

  const preset = AI_PROVIDER_PRESETS[provider];
  const endpoint = resolveProviderEndpoint(preset, rawConfig);
  const apiKey = (rawConfig.apiKey || '').trim();
  let model = (rawConfig.model || preset.defaultModel).trim();

  if (preset.isLocal && !isLoopbackEndpoint(endpoint)) {
    throw new Error(`Security block: local provider "${provider}" must use a loopback URL (127.0.0.1 or localhost).`);
  }
  if (preset.requiresKey && !apiKey) {
    throw new Error(`${preset.label} requires your personal API key in AI Engine settings.`);
  }

  const frames =
    pkg.aiVisionSheets && pkg.aiVisionSheets.length > 0
      ? pkg.aiVisionSheets
      : pkg.capturedFramesBase64 || [];
  const reportedVisionCount = pkg.capturedFramesBase64?.length || frames.length;
  const audioBase64 = pkg.capturedAudioBase64 || '';
  let rawMarkdown = '';
  let usedVisionFrames = 0;
  let usedAudio = false;
  let whisperTranscript = '';
  let transcriptHeading = 'Spoken Audio Transcript (BYOK Whisper)';

  if (provider === 'ollama') {
    const installed = await probeOllamaLocalModels(endpoint, fetchImpl);
    if (installed.length === 0) {
      throw new Error('Ollama is offline or has no pulled models (run e.g. `ollama pull qwen2.5:7b`).');
    }
    if (!model || !installed.includes(model)) {
      const sorted = [...installed].sort(
        (a, b) =>
          Number(frames.length > 0 && isVisionCapableModelName(b)) -
          Number(frames.length > 0 && isVisionCapableModelName(a))
      );
      model = sorted[0];
    }
    const useVision = frames.length > 0 && isVisionCapableModelName(model);
    usedVisionFrames = useVision ? frames.length : 0;

    const res = await fetchImpl(`${endpoint}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: pkg.localAiRefinementPrompt,
        ...(useVision ? { images: frames } : {}),
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`Ollama generation failed (${await readApiErrorDetail(res)}).`);
    const data = (await res.json()) as { response?: string };
    rawMarkdown = data.response || '';
  } else if (provider === 'gemini') {
    const hasAudio = Boolean(audioBase64);
    const hasVision = frames.length > 0;
    const audioPart = hasAudio
      ? [
          {
            inlineData: {
              mimeType: pkg.capturedAudioMimeType || 'audio/webm',
              data: audioBase64,
            },
          },
        ]
      : [];
    const visionParts = hasVision
      ? frames.map((b64) => ({ inlineData: { mimeType: 'image/jpeg', data: b64 } }))
      : [];
    const textOnlyParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { text: pkg.localAiRefinementPrompt },
    ];
    const visionOnlyParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { text: pkg.localAiRefinementPrompt },
      ...visionParts,
    ];
    const fullParts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
      { text: pkg.localAiRefinementPrompt },
      ...audioPart,
      ...visionParts,
    ];

    const sendGemini = (
      targetModel: string,
      partsToSend: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>,
      timeoutMs = hasAudio || hasVision ? 75000 : 45000
    ) =>
      fetchImpl(
        `${endpoint}/v1beta/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: partsToSend }] }),
          ...(fetchImpl === fetch && typeof AbortSignal?.timeout === 'function'
            ? { signal: AbortSignal.timeout(timeoutMs) }
            : {}),
        }
      );

    const candidateModels = await buildCandidateModelsForProvider(
      'gemini',
      model,
      apiKey,
      endpoint,
      hasVision,
      fetchImpl
    );

    const attemptNotes: string[] = [];
    let primaryErrorDetail = 'No Gemini models responded';
    let consecutive429 = 0;

    const tryGeminiCandidates = async (modelList: string[]) => {
      for (let i = 0; i < modelList.length; i++) {
        const candidate = modelList[i];
        onProgress?.(`Trying Gemini model ${i + 1}/${modelList.length}: ${candidate}...`);

        // Gemma 3 supports vision images (not audio); legacy Gemma 1/2 are text-only.
        const isGemma = /^gemma-/i.test(candidate);
        const isGemmaVision = /^gemma-3/i.test(candidate) && hasVision;
        let sentParts = isGemma ? (isGemmaVision ? visionOnlyParts : textOnlyParts) : fullParts;
        let sentWithAudio = !isGemma && hasAudio;
        let sentWithVision = (!isGemma || isGemmaVision) && hasVision;

        let res: Response;
        try {
          res = await sendGemini(candidate, sentParts);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'network timeout';
          if (!attemptNotes.length) primaryErrorDetail = `${candidate}: ${msg}`;
          attemptNotes.push(`${candidate}(timeout)`);
          continue;
        }

        if (res.status === 400 && (sentWithAudio || sentWithVision)) {
          const errDetail = await readApiErrorDetail(res);
          if (/api key not valid/i.test(errDetail)) {
            throw new Error(`Gemini API request failed (${errDetail}).`);
          }
          const canDowngradeMedia =
            /mime|modality|audio|image|not supported|unable to process|invalid argument|inline_data|payload|exceeds|empty/i.test(
              errDetail
            );
          if (canDowngradeMedia) {
            // Step 1: Drop audio first so vision screenshots are preserved for Instagram Reels
            if (sentWithAudio && sentWithVision) {
              onProgress?.(`${candidate} rejected audio — retrying with screenshots + text...`);
              sentParts = visionOnlyParts;
              sentWithAudio = false;
              try {
                res = await sendGemini(candidate, sentParts);
              } catch {
                attemptNotes.push(`${candidate}(timeout)`);
                continue;
              }
            }
            // Step 2: Drop vision too if this specific model is text-only or payload too large
            if (!res.ok && res.status === 400 && sentWithVision) {
              sentParts = textOnlyParts;
              sentWithAudio = false;
              sentWithVision = false;
              try {
                res = await sendGemini(candidate, sentParts);
              } catch {
                attemptNotes.push(`${candidate}(timeout)`);
                continue;
              }
            }
          } else {
            if (!attemptNotes.length) primaryErrorDetail = errDetail;
            attemptNotes.push(`${candidate}(${res.status})`);
            continue;
          }
        }

        if (res.ok) {
          const data = (await res.json()) as {
            candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
          };
          const candidateText =
            data.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '';
          if (candidateText.trim().length >= 220) {
            model = candidate;
            rawMarkdown = candidateText;
            usedAudio = sentWithAudio;
            usedVisionFrames = sentWithVision ? reportedVisionCount : 0;
            return;
          }
          const finishReason = data.candidates?.[0]?.finishReason;
          if (!attemptNotes.length) {
            primaryErrorDetail = finishReason
              ? `${candidate} stopped (${finishReason})`
              : `${candidate} returned short output`;
          }
          attemptNotes.push(`${candidate}(${finishReason || 'short'})`);
          continue;
        }

        const detail = await readApiErrorDetail(res);
        if (!attemptNotes.length || (primaryErrorDetail.includes('404') && res.status !== 404)) {
          primaryErrorDetail = `${candidate}: ${detail}`;
        }
        attemptNotes.push(`${candidate}(${res.status})`);
        if (res.status === 401 || res.status === 403 || /api key not valid/i.test(detail)) {
          throw new Error(`Gemini API request failed (${detail}).`);
        }

        if (res.status === 429) {
          consecutive429++;
          if (fetchImpl === fetch && consecutive429 >= 3) {
            primaryErrorDetail = `${candidate}: ${detail} (free-tier rate limit — wait ~30s or switch to Groq)`;
            return;
          }
        } else {
          consecutive429 = 0;
        }

        if (fetchImpl === fetch && (res.status === 429 || res.status >= 500)) {
          await new Promise((r) => setTimeout(r, res.status === 429 ? 850 : 250));
        }
        if (!isRetryableModelStatus(res.status)) {
          continue;
        }
      }
    };

    const audioCapable = candidateModels.filter((id) => !/^gemma-/i.test(id));
    const gemmaModels = candidateModels.filter((id) => /^gemma-/i.test(id));
    const explicitGemmaRequested = /^gemma-/i.test(candidateModels[0] || '');

    // When spoken audio is present, keep audio-capable Gemini models first (and allow 2-stage
    // audio transcription before dropping audio on Gemma 3), unless user explicitly pinned Gemma.
    await tryGeminiCandidates(
      hasAudio && !explicitGemmaRequested && audioCapable.length > 0 ? audioCapable : candidateModels
    );

    // Two-stage fallback: if monolithic [audio+frames+prompt] timed out or failed while audio exists,
    // transcribe audio cleanly on its own first, then synthesize SKILL.md with transcript + frames.
    if (!rawMarkdown && hasAudio && consecutive429 < 3 && audioCapable.length > 0) {
      let transcribed = '';
      for (const tModel of audioCapable.slice(0, 4)) {
        onProgress?.(`Splitting Reel audio transcription first via ${tModel}...`);
        try {
          const tRes = await sendGemini(
            tModel,
            [
              {
                text: 'Transcribe verbatim every spoken word, tool/library name, URL, number, CLI flag, prompt pattern, and concrete tutorial step in this audio as clean chronological plain text.',
              },
              ...audioPart,
            ],
            55000
          );
          if (tRes.ok) {
            const tJson = (await tRes.json()) as {
              candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
            };
            const textOut =
              tJson.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n').trim() || '';
            if (textOut.length >= 40) {
              transcribed = textOut;
              break;
            }
          }
        } catch {
          // Try next audio transcription candidate
        }
      }

      if (transcribed) {
        whisperTranscript = transcribed;
        transcriptHeading = 'Spoken Audio Transcript (BYOK Gemini)';
        const augmentedPrompt = [
          pkg.localAiRefinementPrompt,
          '',
          '## Full Transcribed Spoken Audio Script',
          sanitizeUntrustedText(transcribed).text,
        ].join('\n');
        const synthParts = hasVision
          ? [{ text: augmentedPrompt }, ...visionParts]
          : [{ text: augmentedPrompt }];

        for (const sModel of candidateModels.slice(0, 6)) {
          onProgress?.(`Synthesizing deep SKILL.md from transcript + visuals via ${sModel}...`);
          try {
            const sRes = await sendGemini(sModel, synthParts, 50000);
            if (sRes.ok) {
              const sJson = (await sRes.json()) as {
                candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
              };
              const sText =
                sJson.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '';
              if (sText.trim().length >= 220) {
                model = sModel;
                rawMarkdown = sText;
                usedAudio = true;
                usedVisionFrames = hasVision ? reportedVisionCount : 0;
                break;
              }
            }
          } catch {
            // Try next synthesizer model
          }
        }
      }
    }

    // Last-resort safety net: try Gemma vision/text models if audio models all failed
    if (!rawMarkdown && hasAudio && !explicitGemmaRequested && consecutive429 < 3 && gemmaModels.length > 0) {
      await tryGeminiCandidates(gemmaModels);
    }

    if (!rawMarkdown) {
      const summary = attemptNotes.slice(0, 6).join(', ');
      throw new Error(
        `Tried ${attemptNotes.length || candidateModels.length} Gemini model(s) [${summary}${attemptNotes.length > 6 ? ', ...' : ''}] — ${primaryErrorDetail}.`
      );
    }
  } else {
    // OpenAI-compatible chat/completions (LM Studio, OpenRouter, Groq, OpenAI)
    let promptWithAudio = pkg.localAiRefinementPrompt;
    if (audioBase64 && (provider === 'groq' || provider === 'openai')) {
      try {
        whisperTranscript = await transcribeAudioWithWhisper(
          endpoint,
          apiKey,
          provider,
          audioBase64,
          pkg.capturedAudioMimeType || 'audio/webm',
          fetchImpl
        );
        if (whisperTranscript) {
          usedAudio = true;
          promptWithAudio = [
            promptWithAudio,
            '',
            '## Spoken Reel Audio Transcript (Transcribed via Whisper)',
            sanitizeUntrustedText(whisperTranscript).text,
          ].join('\n');
        }
      } catch (err: unknown) {
        onProgress?.(
          `Whisper audio skipped (${err instanceof Error ? err.message : 'audio error'}); continuing with screenshots & caption...`
        );
      }
    }

    const chatUrl = endpoint.endsWith('/v1')
      ? `${endpoint}/chat/completions`
      : `${endpoint}/v1/chat/completions`;
    const candidateModels = await buildCandidateModelsForProvider(
      provider,
      model,
      apiKey,
      endpoint,
      frames.length > 0,
      fetchImpl
    );
    const headers = buildOpenAiHeaders(provider, apiKey);

    let lastDetail = 'Request failed';
    for (let i = 0; i < candidateModels.length; i++) {
      const candidate = candidateModels[i];
      onProgress?.(`Trying ${preset.label} model ${i + 1}/${candidateModels.length}: ${candidate}...`);
      let useVision =
        frames.length > 0 && (provider === 'openai' || isVisionCapableModelName(candidate));
      const sendChat = (withVision: boolean) => {
        const userContent = withVision
          ? [
              { type: 'text', text: promptWithAudio },
              ...frames.map((b64) => ({
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${b64}` },
              })),
            ]
          : promptWithAudio;
        return fetchImpl(chatUrl, {
          method: 'POST',
          headers,
          body: buildChatCompletionBody(
            provider,
            candidate,
            [{ role: 'user', content: userContent }],
            0.2
          ),
          ...(fetchImpl === fetch && typeof AbortSignal?.timeout === 'function'
            ? { signal: AbortSignal.timeout(45000) }
            : {}),
        });
      };

      let res: Response;
      try {
        res = await sendChat(useVision);
      } catch (err: unknown) {
        lastDetail = err instanceof Error ? err.message : 'Network error';
        continue;
      }
      if (res.status === 400 && useVision) {
        const errDetail = await readApiErrorDetail(res);
        if (/image|vision|modality|content|array|invalid/i.test(errDetail)) {
          useVision = false;
          try {
            res = await sendChat(false);
          } catch (err: unknown) {
            lastDetail = err instanceof Error ? err.message : 'Network error';
            continue;
          }
        } else {
          lastDetail = errDetail;
          continue;
        }
      }
      if (res.ok) {
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content = data.choices?.[0]?.message?.content || '';
        if (content.trim().length >= 220) {
          model = candidate;
          usedVisionFrames = useVision ? reportedVisionCount : 0;
          rawMarkdown = content;
          break;
        }
        lastDetail = `${candidate} returned short output`;
        continue;
      }
      lastDetail = await readApiErrorDetail(res);
      if (res.status === 401 || res.status === 403) {
        throw new Error(`${preset.label} auth error (${lastDetail}).`);
      }
    }

    if (!rawMarkdown) {
      throw new Error(`${preset.label} tried ${candidateModels.length} model(s): ${lastDetail}.`);
    }
  }

  if (rawMarkdown.trim().length < 220) {
    throw new Error(`Model "${model}" returned insufficient Markdown; kept deterministic draft.`);
  }

  const repairedMd = normalizeAndRepairSkillMarkdown(rawMarkdown, pkg);
  let latestCleanSkillMd = repairedMd;
  let nextPkg = applyRefinedSkillMarkdown(
    pkg,
    repairedMd,
    whisperTranscript || undefined,
    transcriptHeading
  );

  // One targeted repair pass if the in-extension quality gate scores < 75 or finds structural gaps
  let ranRepairPass = false;
  if (nextPkg.qualityReport.score < 75 || !nextPkg.qualityReport.structuralPassed) {
    onProgress?.(
      `Quality gate scored ${nextPkg.qualityReport.score}/100 — running 1 targeted repair pass via ${model}...`
    );
    const evidenceMd =
      nextPkg.files.find((f) => f.relativePath === 'references/source-evidence.md')?.content || '';
    const repairPrompt = buildQualityRepairPrompt(
      nextPkg.files[0]?.content || repairedMd,
      evidenceMd,
      nextPkg.qualityReport,
      pkg.outputMode || 'agent'
    );
    try {
      let repairRaw = '';
      if (provider === 'ollama') {
        const rRes = await fetchImpl(`${endpoint}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: repairPrompt, stream: false }),
        });
        if (rRes.ok) {
          const rData = (await rRes.json()) as { response?: string };
          repairRaw = rData.response || '';
        }
      } else if (provider === 'gemini') {
        const rRes = await fetchImpl(
          `${endpoint}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: repairPrompt }] }] }),
          }
        );
        if (rRes.ok) {
          const rData = (await rRes.json()) as {
            candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          };
          repairRaw =
            rData.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '';
        }
      } else {
        const chatUrl = endpoint.endsWith('/v1')
          ? `${endpoint}/chat/completions`
          : `${endpoint}/v1/chat/completions`;
        const rRes = await fetchImpl(chatUrl, {
          method: 'POST',
          headers: buildOpenAiHeaders(provider, apiKey),
          body: buildChatCompletionBody(
            provider,
            model,
            [{ role: 'user', content: repairPrompt }],
            0.15
          ),
        });
        if (rRes.ok) {
          const rData = (await rRes.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          repairRaw = rData.choices?.[0]?.message?.content || '';
        }
      }

      if (repairRaw.trim().length >= 220) {
        const cleanedRepair = normalizeAndRepairSkillMarkdown(repairRaw, pkg);
        const candidatePkg = applyRefinedSkillMarkdown(
          pkg,
          cleanedRepair,
          whisperTranscript || undefined,
          transcriptHeading
        );
        if (candidatePkg.qualityReport.score >= nextPkg.qualityReport.score) {
          nextPkg = candidatePkg;
          latestCleanSkillMd = cleanedRepair;
          ranRepairPass = true;
        }
      }
    } catch {
      // Keep the first pass if repair request fails
    }
  }

  // Final structural safety net: restore any omitted required sections from the deterministic draft
  if (!nextPkg.qualityReport.structuralPassed) {
    const healedMd = restoreMissingSkillSections(latestCleanSkillMd, pkg);
    const healedPkg = applyRefinedSkillMarkdown(
      pkg,
      healedMd,
      whisperTranscript || undefined,
      transcriptHeading
    );
    if (healedPkg.qualityReport.structuralPassed || healedPkg.qualityReport.score >= nextPkg.qualityReport.score) {
      nextPkg = healedPkg;
    }
  }

  const extras = [
    ...(usedVisionFrames > 0 ? [`${usedVisionFrames} vision frame(s)`] : []),
    ...(usedAudio ? [`${pkg.capturedAudioDurationSeconds || '?'}s audio`] : []),
    ...(ranRepairPass ? ['1 repair pass'] : []),
  ];
  return {
    pkg: nextPkg,
    distilled: true,
    providerUsed: provider,
    modelUsed: model,
    usedVisionFrames,
    usedAudio,
    note: `Auto-distilled via ${preset.label} (${model}, score ${nextPkg.qualityReport.score}/100)${extras.length > 0 ? ` + ${extras.join(' + ')}` : ''}.`,
  };
}

export const AI_CONFIG_STORAGE_KEY = 'skillloomAiConfig';

export async function loadAiConfig(): Promise<AiEngineConfig> {
  const chromeApi = (globalThis as {
    chrome?: {
      storage?: {
        local?: {
          get: (key: string, cb: (res: Record<string, unknown>) => void) => void;
        };
      };
    };
  }).chrome;
  if (!chromeApi?.storage?.local) return { ...DEFAULT_AI_CONFIG };
  return new Promise<AiEngineConfig>((resolve) => {
    chromeApi.storage!.local!.get(AI_CONFIG_STORAGE_KEY, (res) => {
      const raw = res?.[AI_CONFIG_STORAGE_KEY] as Partial<AiEngineConfig> | undefined;
      resolve({ ...DEFAULT_AI_CONFIG, ...(raw || {}) });
    });
  });
}

export async function saveAiConfig(config: AiEngineConfig): Promise<void> {
  const chromeApi = (globalThis as {
    chrome?: {
      storage?: {
        local?: {
          set: (items: Record<string, unknown>, cb?: () => void) => void;
        };
      };
    };
  }).chrome;
  if (!chromeApi?.storage?.local) return;
  return new Promise<void>((resolve) => {
    chromeApi.storage!.local!.set({ [AI_CONFIG_STORAGE_KEY]: config }, () => resolve());
  });
}

export async function requestProviderPermission(provider: AiProviderId): Promise<boolean> {
  const preset = AI_PROVIDER_PRESETS[provider];
  if (!preset.originPermission) return true;
  const permApi = (globalThis as {
    chrome?: {
      permissions?: {
        request: (opts: { origins: string[] }) => Promise<boolean>;
      };
    };
  }).chrome?.permissions;
  if (!permApi?.request) return true;
  try {
    return await permApi.request({ origins: [preset.originPermission] });
  } catch {
    return false;
  }
}
