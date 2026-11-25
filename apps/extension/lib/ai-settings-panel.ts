import {
  AI_PROVIDER_PRESETS,
  type AiEngineConfig,
  type AiProviderId,
  DEFAULT_AI_CONFIG,
  findWorkingModel,
  isLoopbackEndpoint,
  loadAiConfig,
  probeGeminiAvailableModels,
  probeOllamaLocalModels,
  requestProviderPermission,
  saveAiConfig,
} from './ai-engine';

export interface AiSettingsController {
  getConfig: () => AiEngineConfig;
  setActiveModel: (model: string) => Promise<void>;
}

const AI_PANEL_STYLE_ID = 'sl-ai-panel-styles';

function ensureAiPanelStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(AI_PANEL_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = AI_PANEL_STYLE_ID;
  style.textContent = `
    .sl-ai-panel {
      display: flex;
      flex-direction: column;
      gap: 8px;
      min-width: 0;
    }
    .sl-ai-panel.compact {
      padding: 11px;
      background: #111827;
      border: 1px solid rgba(148, 163, 184, 0.24);
      border-radius: 10px;
      margin-bottom: 10px;
    }
    .sl-ai-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding-bottom: 4px;
      border-bottom: 1px solid rgba(148, 163, 184, 0.14);
    }
    .sl-ai-title {
      font-size: 11.5px;
      font-weight: 600;
      color: #f8fafc;
      letter-spacing: -0.01em;
    }
    .sl-ai-close {
      background: transparent;
      border: 1px solid rgba(148, 163, 184, 0.25);
      color: #94a3b8;
      border-radius: 6px;
      width: 22px;
      height: 22px;
      font-size: 13px;
      line-height: 1;
      cursor: pointer;
      display: grid;
      place-items: center;
      padding: 0;
    }
    .sl-ai-close:hover {
      color: #f8fafc;
      background: #182235;
    }
    .sl-ai-label {
      font-size: 11px;
      color: #94a3b8;
      font-weight: 500;
      display: block;
      margin-bottom: 3px;
    }
    .sl-ai-input {
      width: 100%;
      min-width: 0;
      padding: 7px 9px;
      border-radius: 7px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      background: #090d16;
      color: #f8fafc;
      font-size: 12px;
      font-family: inherit;
      box-sizing: border-box;
    }
    .sl-ai-key-row {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
    }
    .sl-ai-key-row .sl-ai-input {
      flex: 1;
    }
    .sl-ai-eye {
      flex: 0 0 auto;
      padding: 6px 8px;
      border-radius: 7px;
      border: 1px solid rgba(148, 163, 184, 0.28);
      background: #0f172a;
      color: #cbd5e1;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
    }
    .sl-ai-eye:hover {
      background: #182235;
    }
    .sl-ai-hint {
      font-size: 11px;
      line-height: 1.42;
      color: #cbd5e1;
      background: rgba(15, 23, 42, 0.85);
      border: 1px solid rgba(148, 163, 184, 0.18);
      border-radius: 7px;
      padding: 7px 9px;
      overflow-wrap: anywhere;
      word-break: break-word;
    }
    .sl-ai-hint a {
      color: #5eead4;
      font-weight: 600;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    .sl-ai-hint a:hover {
      color: #99f6e4;
    }
    .sl-ai-check-row {
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 11.5px;
      color: #cbd5e1;
      cursor: pointer;
    }
    .sl-ai-actions {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px;
    }
    .sl-ai-btn,
    .sl-ai-btn-primary {
      min-width: 0;
      padding: 8px 10px;
      border-radius: 8px;
      font-size: 11.5px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      transition: background 120ms ease, border-color 120ms ease;
    }
    .sl-ai-btn {
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: #0f172a;
      color: #e2e8f0;
    }
    .sl-ai-btn:hover:not(:disabled) {
      background: #182235;
    }
    .sl-ai-btn-primary {
      border: 1px solid rgba(20, 184, 166, 0.45);
      background: rgba(20, 184, 166, 0.16);
      color: #5eead4;
    }
    .sl-ai-btn-primary:hover:not(:disabled) {
      background: rgba(20, 184, 166, 0.25);
    }
    .sl-ai-btn:disabled,
    .sl-ai-btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .sl-ai-panel :is(input, select, button, a):focus-visible {
      outline: 2px solid #14b8a6;
      outline-offset: 2px;
    }
  `;
  document.head.appendChild(style);
}

interface ProviderQuickHelp {
  prefix: string;
  linkLabel?: string;
  linkUrl?: string;
  suffix?: string;
}

const PROVIDER_QUICK_HELP: Record<AiProviderId, ProviderQuickHelp> = {
  none: {
    prefix:
      'Draft mode builds a clean SKILL.md offline in <1s ($0, no key). Choose Google Gemini (free) or Ollama for AI synthesis.',
  },
  gemini: {
    prefix: 'Free Audio + Vision tier! Get a free key at ',
    linkLabel: 'Google AI Studio',
    linkUrl: 'https://aistudio.google.com/apikey',
    suffix: ' — stored locally in your browser only.',
  },
  groq: {
    prefix: 'Fast Whisper audio + Llama LLM. Get a free key at ',
    linkLabel: 'Groq Console',
    linkUrl: 'https://console.groq.com/keys',
    suffix: ' — stored locally only.',
  },
  openrouter: {
    prefix: 'Supports :free vision & text models. Create a key at ',
    linkLabel: 'OpenRouter Keys',
    linkUrl: 'https://openrouter.ai/keys',
    suffix: '.',
  },
  openai: {
    prefix: 'Requires an OpenAI key from ',
    linkLabel: 'OpenAI API Keys',
    linkUrl: 'https://platform.openai.com/api-keys',
    suffix: ' — stored locally only.',
  },
  ollama: {
    prefix:
      '100% offline ($0). Start Ollama on 127.0.0.1:11434 — installed models auto-detect in Model Name above.',
  },
  lm_studio: {
    prefix:
      '100% offline ($0). Enable LM Studio Local Server on port 1234 to distill locally.',
  },
};

function renderQuickHelp(hintEl: HTMLElement, id: AiProviderId): void {
  const info = PROVIDER_QUICK_HELP[id] || PROVIDER_QUICK_HELP.none;
  hintEl.replaceChildren();
  hintEl.append(document.createTextNode(info.prefix));
  if (info.linkLabel && info.linkUrl) {
    const a = document.createElement('a');
    a.href = info.linkUrl;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = info.linkLabel;
    hintEl.append(a);
  }
  if (info.suffix) {
    hintEl.append(document.createTextNode(info.suffix));
  }
}

/**
 * Shared compact AI Engine configurator mounted inside both Popup and Skill Studio
 * so local (Ollama / LM Studio) and BYOK (Gemini / OpenRouter / Groq / OpenAI) settings
 * stay single-sourced and synchronized in chrome.storage.local.
 */
export async function mountAiSettingsPanel(
  container: HTMLElement | null,
  opts: {
    compact?: boolean;
    onConfigChange?: (config: AiEngineConfig) => void;
    onStatus?: (message: string, isError?: boolean) => void;
    onClose?: () => void;
  } = {}
): Promise<AiSettingsController> {
  let config: AiEngineConfig = await loadAiConfig();
  if (!container) {
    return {
      getConfig: () => config,
      setActiveModel: async () => {},
    };
  }

  ensureAiPanelStyles();
  container.replaceChildren();

  const uid = Math.random().toString(36).slice(2, 8);
  const wrapper = document.createElement('div');
  wrapper.className = opts.compact ? 'sl-ai-panel compact' : 'sl-ai-panel';
  wrapper.setAttribute('role', 'region');
  wrapper.setAttribute('aria-label', 'AI Auto-Distiller Settings');

  if (opts.compact) {
    const header = document.createElement('div');
    header.className = 'sl-ai-header';
    const title = document.createElement('span');
    title.className = 'sl-ai-title';
    title.textContent = 'AI Engine (Optional Local / BYOK)';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'sl-ai-close';
    closeBtn.setAttribute('aria-label', 'Close AI settings panel');
    closeBtn.title = 'Close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => opts.onClose?.());
    header.append(title, closeBtn);
    wrapper.appendChild(header);
  }

  // 1. Provider selector
  const providerWrap = document.createElement('div');
  const providerSelectId = `sl-ai-provider-${uid}`;
  const providerLbl = document.createElement('label');
  providerLbl.className = 'sl-ai-label';
  providerLbl.htmlFor = providerSelectId;
  providerLbl.textContent = 'AI Auto-Distiller Engine';
  const providerSelect = document.createElement('select');
  providerSelect.id = providerSelectId;
  providerSelect.className = 'sl-ai-input';
  for (const preset of Object.values(AI_PROVIDER_PRESETS)) {
    const opt = document.createElement('option');
    opt.value = preset.id;
    opt.textContent = preset.label;
    providerSelect.appendChild(opt);
  }
  providerSelect.value = config.provider;
  providerWrap.append(providerLbl, providerSelect);

  // 2. Model input + datalist for detected Ollama / Gemini models
  const modelWrap = document.createElement('div');
  const modelInputId = `sl-ai-model-${uid}`;
  const modelLbl = document.createElement('label');
  modelLbl.className = 'sl-ai-label';
  modelLbl.htmlFor = modelInputId;
  modelLbl.textContent = 'Model Name';
  const modelListId = `sl-models-${uid}`;
  const modelList = document.createElement('datalist');
  modelList.id = modelListId;
  const modelInput = document.createElement('input');
  modelInput.id = modelInputId;
  modelInput.type = 'text';
  modelInput.setAttribute('list', modelListId);
  modelInput.className = 'sl-ai-input';
  modelInput.value = config.model;
  modelWrap.append(modelLbl, modelInput, modelList);

  // 3. Endpoint input (shown for local loopback providers)
  const endpointWrap = document.createElement('div');
  const endpointInputId = `sl-ai-endpoint-${uid}`;
  const endpointLbl = document.createElement('label');
  endpointLbl.className = 'sl-ai-label';
  endpointLbl.htmlFor = endpointInputId;
  endpointLbl.textContent = 'Loopback Endpoint URL';
  const endpointInput = document.createElement('input');
  endpointInput.id = endpointInputId;
  endpointInput.type = 'url';
  endpointInput.className = 'sl-ai-input';
  endpointInput.value = config.endpointUrl;
  endpointWrap.append(endpointLbl, endpointInput);

  // 4. API key input with Show/Hide toggle (shown only for BYOK cloud providers)
  const keyWrap = document.createElement('div');
  const keyInputId = `sl-ai-key-${uid}`;
  const keyLbl = document.createElement('label');
  keyLbl.className = 'sl-ai-label';
  keyLbl.htmlFor = keyInputId;
  keyLbl.textContent = 'Personal API Key (stored locally only)';
  const keyRow = document.createElement('div');
  keyRow.className = 'sl-ai-key-row';
  const keyInput = document.createElement('input');
  keyInput.id = keyInputId;
  keyInput.type = 'password';
  keyInput.autocomplete = 'off';
  keyInput.spellcheck = false;
  keyInput.placeholder = 'Paste your personal provider API key...';
  keyInput.className = 'sl-ai-input';
  keyInput.value = config.apiKey;
  const eyeBtn = document.createElement('button');
  eyeBtn.type = 'button';
  eyeBtn.className = 'sl-ai-eye';
  eyeBtn.textContent = 'Show';
  eyeBtn.setAttribute('aria-label', 'Show API key');
  eyeBtn.setAttribute('aria-pressed', 'false');
  eyeBtn.addEventListener('click', () => {
    const revealing = keyInput.type === 'password';
    keyInput.type = revealing ? 'text' : 'password';
    eyeBtn.textContent = revealing ? 'Hide' : 'Show';
    eyeBtn.setAttribute('aria-label', revealing ? 'Hide API key' : 'Show API key');
    eyeBtn.setAttribute('aria-pressed', revealing ? 'true' : 'false');
  });
  keyRow.append(keyInput, eyeBtn);
  keyWrap.append(keyLbl, keyRow);

  // 4b. Context-aware onboarding / free key hint
  const quickHint = document.createElement('div');
  quickHint.className = 'sl-ai-hint';
  quickHint.setAttribute('role', 'note');

  // 5. Auto-distill toggle + Actions
  const autoRow = document.createElement('label');
  autoRow.className = 'sl-ai-check-row';
  const autoCheckbox = document.createElement('input');
  autoCheckbox.type = 'checkbox';
  autoCheckbox.checked = config.autoDistillOnExport;
  const autoText = document.createElement('span');
  autoText.textContent = 'Auto-refine SKILL.md on Install / Copy / .zip';
  autoRow.append(autoCheckbox, autoText);

  const actionsRow = document.createElement('div');
  actionsRow.className = 'sl-ai-actions';

  const findBtn = document.createElement('button');
  findBtn.type = 'button';
  findBtn.id = 'find-working-model-btn';
  findBtn.className = 'sl-ai-btn';
  findBtn.textContent = 'Find Working Model';
  findBtn.title = 'Probe & lock onto the fastest working model for this provider';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'sl-ai-btn-primary';
  saveBtn.textContent = 'Save AI Settings';

  actionsRow.append(findBtn, saveBtn);

  const refreshFieldVisibility = (resetDefaults = false) => {
    const id = providerSelect.value as AiProviderId;
    const preset = AI_PROVIDER_PRESETS[id] || AI_PROVIDER_PRESETS.none;
    if (resetDefaults) {
      modelInput.value = preset.defaultModel;
      endpointInput.value = preset.defaultEndpoint;
      if (preset.isLocal) keyInput.value = '';
    }
    const isEnabled = id !== 'none';
    modelWrap.style.display = isEnabled ? 'block' : 'none';
    endpointWrap.style.display = isEnabled && preset.isLocal ? 'block' : 'none';
    keyWrap.style.display = isEnabled && preset.requiresKey ? 'block' : 'none';
    autoRow.style.display = isEnabled ? 'flex' : 'none';
    findBtn.style.display = isEnabled ? 'block' : 'none';
    actionsRow.style.gridTemplateColumns = isEnabled ? '1fr 1fr' : '1fr';
    modelInput.placeholder = preset.defaultModel || 'Model ID';
    renderQuickHelp(quickHint, id);

    if (id === 'ollama') {
      void probeOllamaLocalModels(endpointInput.value || preset.defaultEndpoint).then((models) => {
        modelList.replaceChildren();
        for (const m of models) {
          const opt = document.createElement('option');
          opt.value = m;
          modelList.appendChild(opt);
        }
        if (models.length > 0 && (!modelInput.value || modelInput.value === preset.defaultModel)) {
          modelInput.value = models[0];
        }
      });
    } else if (id === 'gemini') {
      const defaults = [
        'gemini-flash-latest',
        'gemini-4-hydrogen',
        'gemini-3.6-flash',
        'gemini-3.5-flash-lite',
      ];
      const setGeminiOptions = (models: string[]) => {
        modelList.replaceChildren();
        for (const m of models) {
          const opt = document.createElement('option');
          opt.value = m;
          modelList.appendChild(opt);
        }
      };
      setGeminiOptions(defaults);
      if (keyInput.value.trim()) {
        void probeGeminiAvailableModels(keyInput.value.trim(), preset.defaultEndpoint).then((live) => {
          if (live.length > 0) setGeminiOptions(live);
        });
      }
    }
  };

  providerSelect.addEventListener('change', () => {
    refreshFieldVisibility(true);
  });

  saveBtn.addEventListener('click', async () => {
    const id = providerSelect.value as AiProviderId;
    const preset = AI_PROVIDER_PRESETS[id] || AI_PROVIDER_PRESETS.none;
    const nextEndpoint = (endpointInput.value || preset.defaultEndpoint).trim();
    const nextKey = keyInput.value.trim();

    if (id !== 'none' && preset.isLocal && !isLoopbackEndpoint(nextEndpoint)) {
      opts.onStatus?.('Local provider must use http://127.0.0.1 or http://localhost only.', true);
      return;
    }
    if (id !== 'none' && preset.requiresKey && !nextKey) {
      opts.onStatus?.(`Please paste your ${preset.label} API key before saving.`, true);
      keyInput.focus();
      return;
    }

    saveBtn.disabled = true;
    saveBtn.setAttribute('aria-busy', 'true');
    try {
      const permGranted = await requestProviderPermission(id);
      if (!permGranted && id !== 'none') {
        opts.onStatus?.(`Origin permission declined for ${preset.label}.`, true);
        return;
      }

      config = {
        ...DEFAULT_AI_CONFIG,
        provider: id,
        model: (modelInput.value || preset.defaultModel).trim(),
        endpointUrl: nextEndpoint,
        apiKey: preset.requiresKey ? nextKey : '',
        autoDistillOnExport: autoCheckbox.checked,
      };
      await saveAiConfig(config);
      opts.onConfigChange?.(config);
      opts.onStatus?.(
        id === 'none'
          ? 'AI Engine set to fast deterministic draft mode.'
          : `Saved ${preset.label} (${config.model}) locally in browser storage.`
      );
    } finally {
      saveBtn.disabled = false;
      saveBtn.removeAttribute('aria-busy');
    }
  });

  const readCurrentInputConfig = (): AiEngineConfig => {
    const id = providerSelect.value as AiProviderId;
    const preset = AI_PROVIDER_PRESETS[id] || AI_PROVIDER_PRESETS.none;
    return {
      ...DEFAULT_AI_CONFIG,
      provider: id,
      model: (modelInput.value || preset.defaultModel).trim(),
      endpointUrl: preset.isLocal
        ? (endpointInput.value || preset.defaultEndpoint).trim()
        : preset.defaultEndpoint,
      apiKey: preset.requiresKey ? keyInput.value.trim() : '',
      autoDistillOnExport: autoCheckbox.checked,
    };
  };

  findBtn.addEventListener('click', async () => {
    const draftCfg = readCurrentInputConfig();
    if (draftCfg.provider === 'none') {
      opts.onStatus?.('Pick Gemini, Groq, OpenRouter, or Ollama first.', true);
      return;
    }
    const preset = AI_PROVIDER_PRESETS[draftCfg.provider];
    if (preset.requiresKey && !draftCfg.apiKey) {
      opts.onStatus?.(`Paste your ${preset.label} API key first to probe models.`, true);
      keyInput.focus();
      return;
    }
    const permGranted = await requestProviderPermission(draftCfg.provider);
    if (!permGranted) {
      opts.onStatus?.(`Origin permission declined for ${draftCfg.provider}.`, true);
      return;
    }

    findBtn.disabled = true;
    saveBtn.disabled = true;
    findBtn.setAttribute('aria-busy', 'true');
    findBtn.textContent = 'Probing...';
    try {
      const result = await findWorkingModel(draftCfg, (idx, total, candidate, note) => {
        opts.onStatus?.(`Probing ${idx}/${total}: ${candidate} (${note || '...'})`);
      });
      if (!result.ok || !result.model) {
        opts.onStatus?.(result.error || 'No working models responded.', true);
        return;
      }
      modelInput.value = result.model;
      config = { ...draftCfg, model: result.model };
      await saveAiConfig(config);
      opts.onConfigChange?.(config);
      opts.onStatus?.(
        `Locked onto working model "${result.model}" (tested ${result.testedCount}) & saved!`
      );
    } finally {
      findBtn.disabled = false;
      saveBtn.disabled = false;
      findBtn.removeAttribute('aria-busy');
      findBtn.textContent = 'Find Working Model';
    }
  });

  wrapper.append(providerWrap, modelWrap, endpointWrap, keyWrap, quickHint, autoRow, actionsRow);
  container.appendChild(wrapper);
  refreshFieldVisibility(false);

  return {
    getConfig: readCurrentInputConfig,
    setActiveModel: async (nextModel: string) => {
      if (!nextModel.trim()) return;
      modelInput.value = nextModel.trim();
      config = { ...readCurrentInputConfig(), model: nextModel.trim() };
      await saveAiConfig(config);
      opts.onConfigChange?.(config);
    },
  };
}
