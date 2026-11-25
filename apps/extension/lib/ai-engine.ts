/**
 * Pure-Browser Multi-Provider AI Skill Distillation Engine (Zero SkillLoom Cloud Servers)
 * Supports local runtimes (Ollama, LM Studio) and user-supplied BYOK keys
 * (Gemini Free Tier, OpenRouter, Groq, OpenAI) stored strictly in chrome.storage.local.
 */
import {
  buildZipUint8Array,
  type BrowserGeneratedSkillPackage,
} from './browser-skill-builder';
import { sanitizeUntrustedText } from './skill-distiller';
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
    defaultModel: 'google/gemma-3-27b-it:free',
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

/**
 * Unwraps markdown code fences if an LLM wrapped its response, ensures valid JSON-quoted
 * YAML frontmatter (`name`, `description`), and strips any injected untrusted patterns.
 */
export function normalizeAndRepairSkillMarkdown(
  rawLlmOutput: string,
  fallbackPkg: BrowserGeneratedSkillPackage
): string {
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

  return `${text.trim()}\n`;
}

export function applyRefinedSkillMarkdown(
  pkg: BrowserGeneratedSkillPackage,
  refinedSkillMd: string,
  audioTranscriptText?: string,
  transcriptHeading = 'Spoken Audio Transcript (BYOK Whisper)'
): BrowserGeneratedSkillPackage {
  const cleanTranscript = audioTranscriptText
    ? sanitizeUntrustedText(audioTranscriptText).text.trim()
    : '';

  const buildUpdated = (skillContent: string) =>
    pkg.files.map((f, idx) => {
      if (idx === 0 && f.relativePath === 'SKILL.md') {
        return { ...f, content: skillContent };
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
  const qualityReport = evaluateSkillQualityGate(finalFiles, pkg.sizeMode);
  if (qualityReport.grade === 'DRAFT') {
    const annotated = annotateDraftSkillMarkdown(refinedSkillMd, qualityReport);
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
      `Install or refine this AI-enriched SkillLoom skill ("${pkg.slug}", quality score: ${qualityReport.score}/100, status: ${qualityReport.grade}) into your local agent skills directory (e.g. \`~/.gemini/config/skills/${pkg.slug}/\` or \`.claude/skills/${pkg.slug}/\`).`,
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
  'llama-3.1-8b-instant',
  'qwen-qwq-32b',
];

const CURATED_OPENROUTER_FALLBACKS = [
  'google/gemma-3-27b-it:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen2.5-vl-72b-instruct:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
];

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
    return unique([requestedModel, ...CURATED_GROQ_FALLBACKS]);
  }
  if (provider === 'openrouter') {
    return unique([requestedModel, ...CURATED_OPENROUTER_FALLBACKS]);
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
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        res = await fetchImpl(chatUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: candidate,
            messages: [{ role: 'user', content: 'Reply OK' }],
            max_tokens: 8,
          }),
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
  return {
    ok: false,
    testedCount: tried.length,
    tried,
    error: `Tested ${tried.length} model(s) [${trace}${tried.length > 6 ? ', ...' : ''}]. First error: ${tried[0]?.detail || last?.detail}.`,
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
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

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
          body: JSON.stringify({
            model: candidate,
            messages: [{ role: 'user', content: userContent }],
            temperature: 0.2,
          }),
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
      nextPkg.qualityReport
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
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
        const rRes = await fetchImpl(chatUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: repairPrompt }],
            temperature: 0.15,
          }),
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
          ranRepairPass = true;
        }
      }
    } catch {
      // Keep the first pass if repair request fails
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
