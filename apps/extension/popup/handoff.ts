import {
  AI_PROVIDER_PRESETS,
  type AiEngineConfig,
  applyRefinedSkillMarkdown,
  distillSkillWithAiEngine,
  requestProviderPermission,
} from '../lib/ai-engine';
import { mountAiSettingsPanel, type AiSettingsController } from '../lib/ai-settings-panel';
import {
  buildBrowserSkillPackage,
  type BrowserGeneratedSkillPackage,
  type BrowserVideoInput,
} from '../lib/browser-skill-builder';
import { buildStoryboardContactSheets } from '../lib/dom-extract-utils';
import {
  type DirectoryHandleLike,
  ensureReadWritePermission,
  installSkillPackageToDirectoryHandle,
  loadSavedSkillsRepoHandle,
  pickAndSaveSkillsRepoHandle,
} from '../lib/repo-installer';

const MAX_STUDIO_FRAMES = 12;

const titleEl = document.getElementById('video-title');
const metaEl = document.getElementById('video-meta');
const slugInputEl = document.getElementById('slug-input') as HTMLInputElement | null;
const coveragePillEl = document.getElementById('coverage-pill');
const badgesEl = document.getElementById('signal-badges');
const qualityBadgeEl = document.getElementById('studio-quality-badge');
const qualityMetricsEl = document.getElementById('studio-quality-metrics');
const qualityGapsEl = document.getElementById('studio-quality-gaps');
const framesPanelEl = document.getElementById('frames-panel');
const framesStripEl = document.getElementById('frames-strip');
const tabsEl = document.getElementById('preview-tabs');
const statusEl = document.getElementById('status-text');
const repoStatusLabelEl = document.getElementById('repo-status-label');
const chooseRepoBtn = document.getElementById('choose-repo-btn') as HTMLButtonElement | null;
const installRepoBtn = document.getElementById('install-repo-btn') as HTMLButtonElement | null;
const copyActiveTabBtn = document.getElementById('copy-active-tab-btn') as HTMLButtonElement | null;
const previewEl = document.getElementById('skill-preview');

const copyBtn = document.getElementById('copy-prompt-btn') as HTMLButtonElement | null;
const refineBtn = document.getElementById('refine-local-ai-btn') as HTMLButtonElement | null;
const studioAiHostEl = document.getElementById('studio-ai-settings-host');
const studioAiBadgeEl = document.getElementById('studio-ai-badge');
const downloadBtn = document.getElementById('download-files-btn') as HTMLButtonElement | null;
const downloadMdBtn = document.getElementById('download-md-btn') as HTMLButtonElement | null;
const manualContextDrawerEl = document.getElementById('manual-context-drawer') as HTMLDetailsElement | null;
const manualTitleInputEl = document.getElementById('manual-title-input') as HTMLInputElement | null;
const manualCaptionInputEl = document.getElementById('manual-caption-input') as HTMLTextAreaElement | null;
const uploadFrameInputEl = document.getElementById('upload-frame-input') as HTMLInputElement | null;

let currentVideo: BrowserVideoInput | null = null;
let generatedPkg: BrowserGeneratedSkillPackage | null = null;
let activeTabPath = 'SKILL.md';
let refinedSkillOverride: string | null = null;
let aiController: AiSettingsController | null = null;
let savedRepoHandle: DirectoryHandleLike | null = null;

function setStatus(msg: string, tone: boolean | 'neutral' | 'error' | 'busy' = false): void {
  if (!statusEl) return;
  statusEl.textContent = msg;
  const resolved = tone === true ? 'error' : tone === false ? 'neutral' : tone;
  statusEl.className =
    resolved === 'error'
      ? 'status-box error'
      : resolved === 'busy'
        ? 'status-box busy'
        : 'status-box';
}

function updateStudioAiBadge(cfg: AiEngineConfig): void {
  if (!studioAiBadgeEl) return;
  if (cfg.provider === 'none') {
    studioAiBadgeEl.textContent = 'Draft Mode';
    studioAiBadgeEl.className = 'drawer-badge off';
    return;
  }
  const shortName =
    cfg.provider === 'lm_studio'
      ? 'LM Studio'
      : cfg.provider.charAt(0).toUpperCase() + cfg.provider.slice(1);
  studioAiBadgeEl.textContent = cfg.model ? `${shortName} · ${cfg.model}` : shortName;
  studioAiBadgeEl.className = 'drawer-badge';
}

function downloadBlobFile(filename: string, data: Uint8Array | string, mime: string): void {
  const part: BlobPart =
    typeof data === 'string'
      ? data
      : (() => {
          const copy = new Uint8Array(data.byteLength);
          copy.set(data);
          return copy;
        })();
  const blob = new Blob([part], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function rebuildPackage(preserveRefined = false): void {
  if (!currentVideo) return;
  generatedPkg = buildBrowserSkillPackage(currentVideo);
  if (preserveRefined && refinedSkillOverride) {
    generatedPkg = applyRefinedSkillMarkdown(generatedPkg, refinedSkillOverride);
  } else {
    refinedSkillOverride = null;
  }

  if (titleEl) {
    titleEl.textContent = generatedPkg.title;
  }
  if (metaEl) {
    const platformLabel = currentVideo.sourcePlatform === 'instagram' ? 'Instagram Reel' : 'YouTube';
    const toolsStr =
      generatedPkg.detectedTools.length > 0 ? generatedPkg.detectedTools.join(', ') : generatedPkg.domain;
    metaEl.textContent = `${platformLabel} · ${currentVideo.channelName} · ${generatedPkg.domain} · ${toolsStr}`;
  }
  if (slugInputEl && document.activeElement !== slugInputEl) {
    slugInputEl.value = generatedPkg.slug;
  }
  if (coveragePillEl) {
    const label =
      generatedPkg.coverageLevel === 'VISUAL_HEAVY_NEEDS_FRAMES'
        ? 'NEEDS FRAMES'
        : generatedPkg.coverageLevel;
    coveragePillEl.textContent = `Coverage: ${label}`;
    coveragePillEl.className =
      generatedPkg.coverageLevel === 'RICH'
        ? 'cov-pill rich'
        : generatedPkg.coverageLevel === 'VISUAL_HEAVY_NEEDS_FRAMES'
          ? 'cov-pill warn'
          : 'cov-pill';
  }

  if (badgesEl) {
    const signalRows: Array<{ label: string; value: string; good?: boolean }> = [
      { label: 'Captions', value: String(generatedPkg.captionCount), good: generatedPkg.captionCount > 0 },
      { label: 'Cmds / Prompts', value: String(generatedPkg.extractedArtifactCount), good: generatedPkg.extractedArtifactCount > 0 },
      { label: 'Pitfalls', value: String(generatedPkg.pitfallCount), good: generatedPkg.pitfallCount > 0 },
      { label: 'Links', value: String(currentVideo.labeledLinks?.length || 0), good: (currentVideo.labeledLinks?.length || 0) > 0 },
      { label: 'Pinned', value: currentVideo.pinnedComment ? 'Captured' : 'None', good: Boolean(currentVideo.pinnedComment) },
      { label: 'Frames', value: String(generatedPkg.capturedFrameCount), good: generatedPkg.capturedFrameCount > 0 },
      ...(generatedPkg.capturedAudioBase64
        ? [
            {
              label: 'Audio',
              value: `${generatedPkg.capturedAudioDurationSeconds || 1}s ✓`,
              good: true,
            },
          ]
        : []),
    ];
    badgesEl.replaceChildren();
    for (const row of signalRows) {
      const box = document.createElement('div');
      box.className = row.good ? 'signal-item good' : 'signal-item';
      const lbl = document.createElement('span');
      lbl.textContent = row.label;
      const val = document.createElement('strong');
      val.textContent = row.value;
      box.append(lbl, val);
      badgesEl.appendChild(box);
    }
  }

  renderQualityPanel();
  renderFramesStrip();
  renderPreviewTabs();
  renderActivePreview();
}

function renderQualityPanel(): void {
  if (!generatedPkg || !qualityBadgeEl || !qualityMetricsEl || !qualityGapsEl) return;
  const q = generatedPkg.qualityReport;
  qualityBadgeEl.textContent = `${q.score}/100 · ${q.grade}`;
  qualityBadgeEl.className =
    q.grade === 'READY' ? 'cov-pill rich' : q.grade === 'BLOCKED' ? 'cov-pill danger' : 'cov-pill warn';

  qualityMetricsEl.textContent = `Size: ${generatedPkg.sizeMode} · Steps: ${q.metrics.stepCount} (${q.metrics.timestampedStepCount} timed) · Concrete values: ${q.metrics.concreteValueCount} · Lines: ${q.metrics.lineCount}`;

  qualityGapsEl.replaceChildren();
  if (q.gaps.length === 0) {
    const li = document.createElement('li');
    li.className = 'quality-ok';
    li.textContent = 'All structural and content checks passed.';
    qualityGapsEl.appendChild(li);
  } else {
    for (const gap of q.gaps) {
      const li = document.createElement('li');
      li.textContent = gap;
      qualityGapsEl.appendChild(li);
    }
  }
}

function renderFramesStrip(): void {
  if (!framesPanelEl || !framesStripEl || !currentVideo) return;
  const frames = currentVideo.capturedFrames || [];
  framesStripEl.replaceChildren();
  if (frames.length === 0) {
    framesPanelEl.style.display = 'none';
    return;
  }
  framesPanelEl.style.display = 'block';
  frames.forEach((frame, idx) => {
    const card = document.createElement('div');
    card.className = 'frame-card';

    const media = document.createElement('div');
    media.className = 'frame-media';

    const img = document.createElement('img');
    img.src = frame.dataUrl;
    img.alt = `Frame ${frame.timestampLabel}`;

    const tsBadge = document.createElement('span');
    tsBadge.className = 'frame-ts';
    tsBadge.textContent = frame.timestampLabel;

    const rmBtn = document.createElement('button');
    rmBtn.type = 'button';
    rmBtn.className = 'frame-rm';
    rmBtn.title = `Remove frame ${frame.timestampLabel}`;
    rmBtn.setAttribute('aria-label', `Remove frame ${frame.timestampLabel}`);
    rmBtn.textContent = '×';
    rmBtn.addEventListener('click', () => {
      if (!currentVideo) return;
      currentVideo.capturedFrames = (currentVideo.capturedFrames || []).filter((_, i) => i !== idx);
      rebuildPackage(false);
      setStatus(`Removed frame [${frame.timestampLabel}].`);
    });

    media.append(img, tsBadge, rmBtn);

    const noteInput = document.createElement('input');
    noteInput.className = 'frame-note';
    noteInput.placeholder = 'Note (e.g. UI settings)';
    noteInput.setAttribute('aria-label', `Annotation note for frame ${frame.timestampLabel}`);
    noteInput.value = frame.note || '';
    noteInput.addEventListener('change', () => {
      frame.note = noteInput.value.trim() || undefined;
      rebuildPackage(Boolean(refinedSkillOverride));
    });

    card.append(media, noteInput);
    framesStripEl.appendChild(card);
  });
}

function renderPreviewTabs(): void {
  if (!tabsEl || !generatedPkg) return;
  const textFiles = generatedPkg.files.filter((f) => !f.binaryBytes);
  if (!textFiles.some((f) => f.relativePath === activeTabPath)) {
    activeTabPath = textFiles[0]?.relativePath || 'SKILL.md';
  }
  tabsEl.replaceChildren();
  for (const file of textFiles) {
    const isActive = file.relativePath === activeTabPath;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = isActive ? 'tab-btn active' : 'tab-btn';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    btn.setAttribute('aria-controls', 'skill-preview');
    btn.textContent = file.relativePath.replace(/^references\/|^evals\//, '');
    btn.title = file.relativePath;
    btn.addEventListener('click', () => {
      activeTabPath = file.relativePath;
      renderPreviewTabs();
      renderActivePreview();
    });
    tabsEl.appendChild(btn);
  }
}

function renderActivePreview(): void {
  if (!previewEl || !generatedPkg) return;
  const target = generatedPkg.files.find((f) => f.relativePath === activeTabPath);
  previewEl.textContent = target?.content || '';
}

async function runAiDistillOnActivePackage(cfg: AiEngineConfig, force = false): Promise<boolean> {
  if (!generatedPkg || cfg.provider === 'none') return false;
  if (!force && (!cfg.autoDistillOnExport || refinedSkillOverride)) return false;

  if (currentVideo && (currentVideo.capturedFrames?.length || 0) >= 3) {
    try {
      const sheets = await buildStoryboardContactSheets(document, currentVideo.capturedFrames!, 3, 2);
      if (sheets.length > 0) {
        generatedPkg = buildBrowserSkillPackage({ ...currentVideo, aiVisionSheets: sheets });
      }
    } catch {
      // Proceed cleanly with individual frames
    }
  }

  const preset = AI_PROVIDER_PRESETS[cfg.provider];
  setStatus(`Distilling real SKILL.md via ${preset.label}...`, 'busy');
  const permOk = await requestProviderPermission(cfg.provider);
  if (!permOk) {
    setStatus(`Origin permission declined for ${preset.label}; keeping deterministic draft.`, true);
    return false;
  }

  try {
    const out = await distillSkillWithAiEngine(generatedPkg, cfg, fetch, (progress) =>
      setStatus(progress, 'busy')
    );
    if (out.distilled) {
      if (out.modelUsed && out.modelUsed !== cfg.model && aiController) {
        await aiController.setActiveModel(out.modelUsed);
      }
      refinedSkillOverride = out.pkg.files[0]?.content || null;
      generatedPkg = out.pkg;
      activeTabPath = 'SKILL.md';
      renderQualityPanel();
      renderPreviewTabs();
      renderActivePreview();
      setStatus(out.note || `Distilled SKILL.md cleanly via ${preset.label}!`);
      return true;
    }
    return false;
  } catch (err: unknown) {
    setStatus(
      `AI distill skipped (${err instanceof Error ? err.message : 'unavailable'}); using deterministic draft.`,
      true
    );
    return false;
  }
}

function updateRepoUi(handle: DirectoryHandleLike | null): void {
  savedRepoHandle = handle;
  if (repoStatusLabelEl) {
    repoStatusLabelEl.textContent = handle ? `Repo: ${handle.name}/ ✓` : 'Repo: Not chosen yet';
    repoStatusLabelEl.style.color = handle ? '#5eead4' : '#94a3b8';
  }
  if (installRepoBtn) {
    installRepoBtn.textContent = handle
      ? `Install Skill to ${handle.name}/`
      : 'Choose Repo & Install Skill';
  }
}

async function initHandoff(): Promise<void> {
  aiController = await mountAiSettingsPanel(studioAiHostEl, {
    onConfigChange: (cfg) => updateStudioAiBadge(cfg),
    onStatus: (msg, isError) => setStatus(msg, Boolean(isError)),
  });
  updateStudioAiBadge(aiController.getConfig());
  updateRepoUi(await loadSavedSkillsRepoHandle());

  const chromeApi = (globalThis as {
    chrome?: {
      storage?: {
        local: {
          get: (
            key: string,
            cb: (res: { pendingAgentBundle?: BrowserVideoInput }) => void
          ) => void;
        };
      };
    };
  }).chrome;

  chromeApi?.storage?.local.get('pendingAgentBundle', (res) => {
    const video = res?.pendingAgentBundle;
    if (!video) {
      if (titleEl) titleEl.textContent = 'No tutorial capture loaded';
      if (metaEl) metaEl.textContent = 'Open a YouTube tutorial or Instagram Reel and click "Open Skill Studio" in SkillLoom.';
      if (previewEl) previewEl.textContent = '';
      setStatus('No active capture found.', true);
      return;
    }

    currentVideo = video;
    if (manualTitleInputEl) manualTitleInputEl.value = currentVideo.title || '';
    if (manualCaptionInputEl) manualCaptionInputEl.value = currentVideo.description || '';
    if (
      manualContextDrawerEl &&
      (currentVideo.sourcePlatform === 'instagram' ||
        (currentVideo.transcriptSegments?.length || 0) === 0)
    ) {
      manualContextDrawerEl.open = true;
    }
    rebuildPackage(false);

    const urlAction = new URLSearchParams(window.location.search).get('action');
    if (generatedPkg) {
      const isIg = currentVideo.sourcePlatform === 'instagram';
      if (urlAction === 'chooseRepo') {
        setStatus('Click "Choose Folder..." or "Choose Repo & Install Skill" above to set your permanent Skills folder (Plan A), or use Plan B: Copy Prompt.');
      } else if (urlAction === 'installRepo') {
        setStatus(
          savedRepoHandle
            ? `Click "Install Skill to ${savedRepoHandle.name}/" to confirm folder access & install automatically.`
            : 'Click "Choose Repo & Install Skill" to pick your Skills folder.'
        );
      } else if (generatedPkg.captionCount === 0 && generatedPkg.coverageLevel === 'VISUAL_HEAVY_NEEDS_FRAMES') {
        setStatus(
          isIg
            ? '0 spoken captions exposed in Reel DOM — review attached keyframe(s) & caption, snap extra beats in popup if needed, or run AI Vision.'
            : '0 captions captured — open YouTube "Show transcript" or snap key frames for richer workflow synthesis.',
          !isIg
        );
      } else if (generatedPkg.captionCount === 0 && isIg) {
        setStatus(
          `Synthesized Reel from caption, comments & ${generatedPkg.capturedFrameCount} frame(s). Plan A installs directly to your Skills Repo!`
        );
      } else if (generatedPkg.coverageLevel === 'VISUAL_HEAVY_NEEDS_FRAMES') {
        setStatus(
          `${generatedPkg.captionCount} captions captured, but speaker references ${generatedPkg.blindspotCount} visual moments — consider snapping key frames!`
        );
      } else {
        setStatus(
          `Ready: ${generatedPkg.files.length - 1} skill files. Plan A installs directly into your Skills Repo; Plan B copies prompt for AI chat.`
        );
      }
    }
  });

  slugInputEl?.addEventListener('input', () => {
    if (!currentVideo) return;
    currentVideo.customSlug = slugInputEl.value;
    rebuildPackage(Boolean(refinedSkillOverride));
  });

  chooseRepoBtn?.addEventListener('click', async () => {
    const picked = await pickAndSaveSkillsRepoHandle();
    if (!picked.ok || !picked.handle) {
      setStatus(picked.error || 'Could not select folder.', true);
      return;
    }
    updateRepoUi(picked.handle);
    setStatus(`Saved "${picked.handle.name}/" as your permanent Skills Repo! Future captures install here cleanly.`);
  });

  installRepoBtn?.addEventListener('click', async () => {
    if (!generatedPkg || !installRepoBtn) return;
    installRepoBtn.disabled = true;
    try {
      let targetHandle = savedRepoHandle;
      if (!targetHandle) {
        const picked = await pickAndSaveSkillsRepoHandle();
        if (!picked.ok || !picked.handle) {
          setStatus(picked.error || 'Pick a Skills folder first, or use Plan B: Copy Prompt.', true);
          return;
        }
        targetHandle = picked.handle;
        updateRepoUi(targetHandle);
      }

      const permOk = await ensureReadWritePermission(targetHandle);
      if (!permOk) {
        setStatus(`Write permission declined for "${targetHandle.name}/".`, true);
        return;
      }

      if (aiController) {
        await runAiDistillOnActivePackage(aiController.getConfig(), false);
      }
      if (!generatedPkg.qualityReport.structuralPassed) {
        setStatus(
          `Blocked by Quality Gate (${generatedPkg.qualityReport.score}/100): ${generatedPkg.qualityReport.structuralIssues[0] || 'Structural safety check failed.'}`,
          true
        );
        return;
      }
      setStatus(`Writing skill package to ${targetHandle.name}/...`, 'busy');
      const installed = await installSkillPackageToDirectoryHandle(generatedPkg, targetHandle);
      setStatus(
        `Installed ${installed.fileCount} files (${generatedPkg.qualityReport.score}/100 · ${generatedPkg.qualityReport.grade}) into ${installed.installedPath}!`
      );
    } catch (err: unknown) {
      setStatus(
        `Could not write to saved repo (${err instanceof Error ? err.message : 'locked'}). Try "Choose Folder..." or Plan B: Copy Prompt.`,
        true
      );
    } finally {
      installRepoBtn.disabled = false;
    }
  });

  copyActiveTabBtn?.addEventListener('click', async () => {
    if (!generatedPkg) return;
    const target = generatedPkg.files.find((f) => f.relativePath === activeTabPath);
    if (!target) return;
    try {
      await navigator.clipboard.writeText(target.content);
      copyActiveTabBtn.textContent = 'Copied ✓';
      setTimeout(() => {
        copyActiveTabBtn.textContent = 'Copy Active File';
      }, 1500);
    } catch {
      // ignore
    }
  });

  refineBtn?.addEventListener('click', async () => {
    if (!generatedPkg || !refineBtn || !aiController) return;
    const cfg = aiController.getConfig();
    if (cfg.provider === 'none') {
      setStatus('Select Ollama, LM Studio, or a BYOK AI provider above and click Save AI Settings first.', true);
      return;
    }
    refineBtn.disabled = true;
    try {
      await runAiDistillOnActivePackage(cfg, true);
    } finally {
      refineBtn.disabled = false;
    }
  });

  copyBtn?.addEventListener('click', async () => {
    if (!generatedPkg) return;
    if (aiController) {
      await runAiDistillOnActivePackage(aiController.getConfig(), false);
    }
    try {
      await navigator.clipboard.writeText(generatedPkg.agentEvalPrompt);
      setStatus(`Copied full prompt for "${generatedPkg.slug}" to clipboard!`);
    } catch {
      downloadBlobFile(generatedPkg.zipFilename, generatedPkg.zipBytes, 'application/zip');
      setStatus(`Clipboard blocked — downloaded ${generatedPkg.zipFilename} instead.`);
    }
  });

  downloadBtn?.addEventListener('click', async () => {
    if (!generatedPkg) return;
    if (aiController) {
      await runAiDistillOnActivePackage(aiController.getConfig(), false);
    }
    downloadBlobFile(generatedPkg.zipFilename, generatedPkg.zipBytes, 'application/zip');
    setStatus(`Downloaded ${generatedPkg.zipFilename} (${generatedPkg.files.length} files).`);
  });

  downloadMdBtn?.addEventListener('click', async () => {
    if (!generatedPkg) return;
    if (aiController) {
      await runAiDistillOnActivePackage(aiController.getConfig(), false);
    }
    downloadBlobFile(
      `${generatedPkg.slug}-SKILL.md`,
      generatedPkg.files[0]?.content || '',
      'text/markdown;charset=utf-8'
    );
    setStatus(`Downloaded ${generatedPkg.slug}-SKILL.md.`);
  });

  const appendImageFilesToFrames = async (files: File[]) => {
    if (!currentVideo || files.length === 0) return;
    const added: NonNullable<BrowserVideoInput['capturedFrames']> = [];
    for (const file of files.slice(0, MAX_STUDIO_FRAMES)) {
      if (!file.type.startsWith('image/')) continue;
      const dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const rawUrl = typeof reader.result === 'string' ? reader.result : '';
          if (!rawUrl) {
            resolve(null);
            return;
          }
          const img = new Image();
          img.onload = () => {
            try {
              const targetW = Math.min(720, img.naturalWidth || 720);
              const scale = targetW / Math.max(1, img.naturalWidth || targetW);
              const targetH = Math.max(1, Math.round((img.naturalHeight || 720) * scale));
              const canvas = document.createElement('canvas');
              canvas.width = targetW;
              canvas.height = targetH;
              const ctx = canvas.getContext('2d');
              if (!ctx) {
                resolve(rawUrl);
                return;
              }
              ctx.drawImage(img, 0, 0, targetW, targetH);
              resolve(canvas.toDataURL('image/jpeg', 0.8));
            } catch {
              resolve(rawUrl);
            }
          };
          img.onerror = () => resolve(null);
          img.src = rawUrl;
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
      if (!dataUrl) continue;
      const idx = (currentVideo.capturedFrames?.length || 0) + added.length + 1;
      added.push({
        id: `manual-img-${Date.now()}-${idx}`,
        timestampSeconds: 0,
        timestampLabel: `slide-${idx}`,
        dataUrl,
        source: 'visible_tab',
      });
    }

    if (added.length > 0) {
      currentVideo.capturedFrames = [...(currentVideo.capturedFrames || []), ...added].slice(
        0,
        MAX_STUDIO_FRAMES
      );
      rebuildPackage(false);
      setStatus(
        `Added ${added.length} screenshot(s) (${currentVideo.capturedFrames.length}/${MAX_STUDIO_FRAMES}). Run AI Auto-Distill or Plan A/B!`
      );
    }
  };

  manualTitleInputEl?.addEventListener('input', () => {
    if (!currentVideo) return;
    const nextTitle = manualTitleInputEl.value.trim();
    if (nextTitle) {
      currentVideo.title = nextTitle;
      rebuildPackage(Boolean(refinedSkillOverride));
    }
  });

  manualCaptionInputEl?.addEventListener('input', () => {
    if (!currentVideo) return;
    currentVideo.description = manualCaptionInputEl.value;
    rebuildPackage(Boolean(refinedSkillOverride));
  });

  uploadFrameInputEl?.addEventListener('change', () => {
    const selected = Array.from(uploadFrameInputEl.files || []);
    void appendImageFilesToFrames(selected);
    uploadFrameInputEl.value = '';
  });

  document.addEventListener('paste', (ev) => {
    const files = Array.from(ev.clipboardData?.files || []).filter((f) =>
      f.type.startsWith('image/')
    );
    if (files.length > 0) {
      ev.preventDefault();
      void appendImageFilesToFrames(files);
    }
  });
}

initHandoff();
