/**
 * SkillLoom Shared Chromium MV3 Extension Popup Controller
 * Clean Signal Card + Progressive Actions + Visual Frame Snap + Zero-.exe Inbox Drop.
 */
import {
  type AiEngineConfig,
  AI_PROVIDER_PRESETS,
  distillSkillWithAiEngine,
  requestProviderPermission,
} from '../lib/ai-engine';
import { mountAiSettingsPanel, type AiSettingsController } from '../lib/ai-settings-panel';
import { type BrowserCompatProfile, detectChromiumBrowser } from '../lib/browser-compat';
import {
  type BrowserGeneratedSkillPackage,
  buildBrowserSkillPackage,
  type BrowserVideoInput,
} from '../lib/browser-skill-builder';
import {
  buildFallbackInstagramVideoFromTab,
  buildStoryboardContactSheets,
  computeStoryboardTimestamps,
  formatSecondsToTimestamp,
} from '../lib/dom-extract-utils';
import {
  type DirectoryHandleLike,
  installSkillPackageToDirectoryHandle,
  loadSavedSkillsRepoHandle,
} from '../lib/repo-installer';

type CapturedFrame = NonNullable<BrowserVideoInput['capturedFrames']>[number];

interface ActiveTabVideo extends BrowserVideoInput {
  durationSeconds: number;
  transcriptSegments: Array<{
    startSeconds?: number;
    endSeconds?: number;
    timestampLabel?: string;
    text?: string;
  }>;
  captionsAccessible: boolean;
  isDrmProtected: boolean;
}

const MAX_STORED_FRAMES = 12;
const ONBOARDING_DISMISSED_KEY = 'skillloomOnboardingDismissed';

const browserLabelEl = document.getElementById('browser-label');
const titleEl = document.getElementById('video-title');
const metaEl = document.getElementById('video-meta');
const chipsEl = document.getElementById('signal-chips');
const qualityBoxEl = document.getElementById('quality-box');
const qualityBadgeEl = document.getElementById('quality-badge');
const qualityGapsEl = document.getElementById('quality-gaps');
const thumbsRowEl = document.getElementById('thumbs-row');
const frameCounterEl = document.getElementById('frame-counter');

const installRepoBtn = document.getElementById('install-repo-btn') as HTMLButtonElement | null;
const installRepoLabelEl = document.getElementById('install-repo-label');
const changeRepoBtn = document.getElementById('change-repo-btn') as HTMLButtonElement | null;
const copyPromptBtn = document.getElementById('copy-prompt-btn') as HTMLButtonElement | null;
const snapFrameBtn = document.getElementById('snap-frame-btn') as HTMLButtonElement | null;
const recordAudioBtn = document.getElementById('record-audio-btn') as HTMLButtonElement | null;
const recordAudioLabelEl = document.getElementById('record-audio-label');
const agentFolderBtn = document.getElementById('agent-folder-btn') as HTMLButtonElement | null;
const grantSiteBtn = document.getElementById('grant-site-btn') as HTMLButtonElement | null;
const exportBtn = document.getElementById('export-btn') as HTMLButtonElement | null;
const exportMdBtn = document.getElementById('export-md-btn') as HTMLButtonElement | null;
const statusEl = document.getElementById('status-text');
const aiToggleBtn = document.getElementById('ai-toggle-btn') as HTMLButtonElement | null;
const aiPillLabelEl = document.getElementById('ai-pill-label');
const aiDotEl = document.getElementById('ai-dot');
const aiSettingsHostEl = document.getElementById('ai-settings-host');
const onboardingTipEl = document.getElementById('onboarding-tip');
const dismissOnboardingBtn = document.getElementById('dismiss-onboarding-btn') as HTMLButtonElement | null;

let activeVideo: ActiveTabVideo | null = null;
let activeTabId: number | null = null;
let aiController: AiSettingsController | null = null;
let savedRepoHandle: DirectoryHandleLike | null = null;
let isRecordingAudio = false;
let recordingTimerInterval: ReturnType<typeof setInterval> | null = null;
let activeAutoCapturePromise: Promise<CapturedFrame[]> | null = null;

function setStatus(msg: string, tone: 'neutral' | 'success' | 'error' | 'busy' = 'neutral'): void {
  if (!statusEl) return;
  statusEl.textContent = msg;
  statusEl.className =
    tone === 'success'
      ? 'status-banner success'
      : tone === 'error'
        ? 'status-banner error'
        : tone === 'busy'
          ? 'status-banner busy'
          : 'status-banner';
}

function getExtensionsUrlForProfile(profile: BrowserCompatProfile): string {
  switch (profile.browser) {
    case 'edge':
      return 'edge://extensions';
    case 'brave':
      return 'brave://extensions';
    case 'opera':
      return 'opera://extensions';
    default:
      return 'chrome://extensions';
  }
}

function setInstallBtnText(text: string): void {
  if (installRepoLabelEl) {
    installRepoLabelEl.textContent = text;
  } else if (installRepoBtn) {
    installRepoBtn.textContent = text;
  }
}

function setRecordBtnText(text: string): void {
  if (recordAudioLabelEl) {
    recordAudioLabelEl.textContent = text;
  } else if (recordAudioBtn) {
    recordAudioBtn.textContent = text;
  }
}

function downscaleImageDataUrl(
  rawUrl: string,
  maxWidth = 960,
  quality = 0.78
): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const w = img.naturalWidth || maxWidth;
        const h = img.naturalHeight || maxWidth;
        if (w <= maxWidth && rawUrl.length <= 160_000) {
          resolve(rawUrl);
          return;
        }
        const targetW = Math.min(maxWidth, w);
        const targetH = Math.max(1, Math.round(h * (targetW / Math.max(1, w))));
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawUrl);
          return;
        }
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve(compressed && compressed.startsWith('data:image/') ? compressed : rawUrl);
      } catch {
        resolve(rawUrl);
      }
    };
    img.onerror = () => resolve(rawUrl);
    img.src = rawUrl;
  });
}

function triggerBinaryDownload(filename: string, bytes: Uint8Array, mime: string): void {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const blob = new Blob([copy], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderVideoSummary(): void {
  if (!activeVideo) return;
  const previewPkg = buildBrowserSkillPackage(activeVideo);
  const capCount = activeVideo.transcriptSegments?.length || 0;
  const frameCount = activeVideo.capturedFrames?.length || 0;
  const linkCount = activeVideo.labeledLinks?.length || 0;

  if (metaEl) {
    const platformLabel = activeVideo.sourcePlatform === 'instagram' ? 'Instagram Reel' : 'YouTube';
    const mins =
      activeVideo.durationSeconds > 0
        ? activeVideo.durationSeconds < 60
          ? `${activeVideo.durationSeconds}s`
          : `${Math.max(1, Math.round(activeVideo.durationSeconds / 60))} min`
        : 'Live / Loading';
    metaEl.textContent = `${platformLabel} · ${activeVideo.channelName} · ${mins} · ${previewPkg.domain}`;
  }

  if (frameCounterEl) {
    frameCounterEl.textContent = `(${frameCount}/${MAX_STORED_FRAMES})`;
  }

  if (chipsEl) {
    chipsEl.replaceChildren();
    const chipItems: Array<{ text: string; tone?: 'good' | 'warn' }> = [
      {
        text: capCount > 0 ? `${capCount} Captions ✓` : '0 Captions',
        tone: capCount > 0 ? 'good' : 'warn',
      },
      {
        text: `${previewPkg.extractedArtifactCount} Cmds/Prompts`,
        tone: previewPkg.extractedArtifactCount > 0 ? 'good' : undefined,
      },
      { text: `${linkCount} Links` },
      ...(activeVideo.capturedAudio
        ? [{ text: `Audio ${Math.round(activeVideo.capturedAudio.durationSeconds || 1)}s ✓`, tone: 'good' as const }]
        : []),
      ...(activeVideo.pinnedComment ? [{ text: 'Pinned ✓', tone: 'good' as const }] : []),
      {
        text: `Coverage: ${previewPkg.coverageLevel === 'VISUAL_HEAVY_NEEDS_FRAMES' ? 'Needs Frames' : previewPkg.coverageLevel}`,
        tone: previewPkg.coverageLevel === 'RICH' ? 'good' : previewPkg.coverageLevel === 'VISUAL_HEAVY_NEEDS_FRAMES' ? 'warn' : undefined,
      },
    ];
    for (const item of chipItems) {
      const span = document.createElement('span');
      span.className = item.tone ? `chip ${item.tone}` : 'chip';
      span.textContent = item.text;
      chipsEl.appendChild(span);
    }
  }

  if (qualityBoxEl && qualityBadgeEl && qualityGapsEl) {
    const q = previewPkg.qualityReport;
    qualityBoxEl.style.display = 'block';
    qualityBadgeEl.textContent = `${q.score}/100 · ${q.grade}`;
    qualityBadgeEl.className =
      q.grade === 'READY' ? 'chip good' : q.grade === 'BLOCKED' ? 'chip danger' : 'chip warn';
    qualityGapsEl.replaceChildren();
    if (q.gaps.length === 0) {
      qualityGapsEl.style.display = 'none';
    } else {
      qualityGapsEl.style.display = 'block';
      for (const gap of q.gaps.slice(0, 3)) {
        const li = document.createElement('li');
        li.textContent = gap;
        qualityGapsEl.appendChild(li);
      }
    }
  }

  if (thumbsRowEl) {
    thumbsRowEl.replaceChildren();
    const frames = activeVideo.capturedFrames || [];
    if (frames.length === 0) {
      thumbsRowEl.style.display = 'none';
    } else {
      thumbsRowEl.style.display = 'flex';
      frames.forEach((f, idx) => {
        const box = document.createElement('div');
        box.className = 'thumb';
        box.setAttribute('role', 'listitem');
        const img = document.createElement('img');
        img.src = f.dataUrl;
        img.alt = `Keyframe ${f.timestampLabel}`;
        const badge = document.createElement('span');
        badge.textContent = f.timestampLabel;
        const rmBtn = document.createElement('button');
        rmBtn.type = 'button';
        rmBtn.className = 'thumb-rm';
        rmBtn.title = `Remove frame ${f.timestampLabel}`;
        rmBtn.setAttribute('aria-label', `Remove frame ${f.timestampLabel}`);
        rmBtn.textContent = '×';
        rmBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (!activeVideo) return;
          const next = (activeVideo.capturedFrames || []).filter((_, i) => i !== idx);
          activeVideo.capturedFrames = next;
          const chromeStorage = (globalThis as {
            chrome?: {
              storage?: {
                local?: {
                  get: (k: string, cb: (r: Record<string, Record<string, unknown>>) => void) => void;
                  set: (items: Record<string, unknown>) => void;
                };
              };
            };
          }).chrome?.storage?.local;
          if (chromeStorage?.get) {
            const vid = activeVideo.videoId;
            chromeStorage.get('capturedFramesByVideo', (r) => {
              const map = { ...(r?.capturedFramesByVideo || {}) };
              map[vid] = next;
              chromeStorage.set({ capturedFramesByVideo: map });
            });
          }
          renderVideoSummary();
          setStatus(`Removed frame [${f.timestampLabel}] (${next.length}/${MAX_STORED_FRAMES}).`);
        });
        box.append(img, badge, rmBtn);
        thumbsRowEl.appendChild(box);
      });
    }
  }
}

function updateAiPill(cfg: AiEngineConfig): void {
  if (!aiPillLabelEl || !aiToggleBtn || !aiDotEl) return;
  if (cfg.provider === 'none') {
    aiPillLabelEl.textContent = 'AI: Draft';
    aiToggleBtn.className = 'pill';
    aiDotEl.style.background = '#64748b';
  } else {
    const shortName =
      cfg.provider === 'lm_studio'
        ? 'LM Studio'
        : cfg.provider.charAt(0).toUpperCase() + cfg.provider.slice(1);
    aiPillLabelEl.textContent = `AI: ${shortName}`;
    aiToggleBtn.className = 'pill online';
    aiDotEl.style.background = '#2dd4bf';
  }
}

async function buildAndAutoDistill(video: ActiveTabVideo): Promise<{
  pkg: BrowserGeneratedSkillPackage;
  distillNote?: string;
}> {
  if (activeAutoCapturePromise) {
    setStatus('Finishing automatic keyframe capture...', 'busy');
    try {
      await activeAutoCapturePromise;
    } catch {
      // Proceed cleanly with whatever context is available
    }
  }
  let videoForBuild: ActiveTabVideo = video;
  if ((video.capturedFrames?.length || 0) >= 3) {
    try {
      const sheets = await buildStoryboardContactSheets(document, video.capturedFrames!, 3, 2);
      if (sheets.length > 0) {
        videoForBuild = { ...video, aiVisionSheets: sheets };
      }
    } catch {
      // Fall back to individual frames if canvas stitching fails
    }
  }
  const draft = buildBrowserSkillPackage(videoForBuild);
  const cfg = aiController?.getConfig();
  if (!cfg || cfg.provider === 'none' || !cfg.autoDistillOnExport) {
    return { pkg: draft };
  }
  const preset = AI_PROVIDER_PRESETS[cfg.provider];
  setStatus(`Auto-distilling SKILL.md with ${preset.label}...`, 'busy');
  const granted = await requestProviderPermission(cfg.provider);
  if (!granted) {
    return {
      pkg: draft,
      distillNote: `Origin permission declined for ${preset.label} (saved draft).`,
    };
  }
  try {
    const res = await distillSkillWithAiEngine(draft, cfg, fetch, (progress) => setStatus(progress, 'busy'));
    if (res.distilled && res.modelUsed && res.modelUsed !== cfg.model && aiController) {
      await aiController.setActiveModel(res.modelUsed);
    }
    return { pkg: res.pkg, distillNote: res.note };
  } catch (err: unknown) {
    return {
      pkg: draft,
      distillNote: `AI distill skipped (${err instanceof Error ? err.message : 'unavailable'}); saved clean draft.`,
    };
  }
}

async function initPopup(): Promise<void> {
  const profile = detectChromiumBrowser();
  const extensionsUrl = getExtensionsUrlForProfile(profile);
  if (browserLabelEl) browserLabelEl.textContent = `${profile.label} · MV3`;

  const setAiDrawerOpen = (open: boolean, returnFocus = false) => {
    if (!aiSettingsHostEl || !aiToggleBtn) return;
    aiSettingsHostEl.style.display = open ? 'block' : 'none';
    aiToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (!open && returnFocus) {
      aiToggleBtn.focus();
    }
  };

  aiController = await mountAiSettingsPanel(aiSettingsHostEl, {
    compact: true,
    onConfigChange: (cfg) => {
      updateAiPill(cfg);
      setAiDrawerOpen(false);
      if (cfg.provider !== 'none' && onboardingTipEl) {
        onboardingTipEl.style.display = 'none';
      }
    },
    onStatus: (msg, isError) => setStatus(msg, isError ? 'error' : 'success'),
    onClose: () => setAiDrawerOpen(false, true),
  });
  updateAiPill(aiController.getConfig());

  aiToggleBtn?.addEventListener('click', () => {
    if (!aiSettingsHostEl) return;
    const isHidden = aiSettingsHostEl.style.display === 'none';
    setAiDrawerOpen(isHidden);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && aiSettingsHostEl && aiSettingsHostEl.style.display !== 'none') {
      ev.preventDefault();
      setAiDrawerOpen(false, true);
    }
  });

  savedRepoHandle = await loadSavedSkillsRepoHandle();
  setInstallBtnText(
    savedRepoHandle ? `Install to ${savedRepoHandle.name}/` : 'Choose Skills Repo...'
  );

  const chromeApi = (globalThis as {
    chrome?: {
      tabs: {
        query: (
          q: { active: boolean; currentWindow: boolean },
          cb: (tabs: Array<{ id?: number; url?: string; title?: string }>) => void
        ) => void;
        create?: (opts: { url: string }) => void;
        sendMessage: (
          tabId: number,
          msg: unknown,
          cb: (res?: {
            ok?: boolean;
            data?: ActiveTabVideo;
            frame?: CapturedFrame;
            frames?: CapturedFrame[];
            taintedOrBlocked?: boolean;
            durationSeconds?: number;
            originalTime?: number;
            wasPaused?: boolean;
            timestampSeconds?: number;
            timestampLabel?: string;
          }) => void
        ) => void;
      };
      storage?: {
        local: {
          get: (
            key: string | string[],
            cb: (res: {
              capturedFramesByVideo?: Record<string, CapturedFrame[]>;
              capturedAudioByVideo?: Record<
                string,
                { dataUrl: string; durationSeconds: number; mimeType?: string }
              >;
              activeReelRecording?: { videoId?: string; tabId?: number; startedAt?: number } | null;
              skillloomOnboardingDismissed?: boolean;
            }) => void
          ) => void;
          set: (items: Record<string, unknown>, cb?: () => void) => void;
        };
      };
      tabCapture?: {
        getMediaStreamId: (
          opts: { targetTabId: number },
          cb: (streamId: string) => void
        ) => void;
      };
      permissions?: {
        getAll?: (cb: (perms: { origins?: string[]; permissions?: string[] }) => void) => void;
        request?: (
          opts: { origins: string[] },
          cb?: (granted: boolean) => void
        ) => Promise<boolean> | void;
      };
      scripting?: {
        executeScript: (
          injection: { target: { tabId: number }; files: string[] },
          cb?: () => void
        ) => void;
      };
      runtime: {
        lastError?: { message?: string };
        getURL?: (path: string) => string;
        sendMessage: (
          msg: unknown,
          cb: (res?: { ok?: boolean; jobId?: string; stateLabel?: string; error?: string; dataUrl?: string }) => void
        ) => void;
      };
    };
  }).chrome;

  if (!chromeApi?.tabs) return;

  // Show compact first-run tip only when neither repo nor AI provider is configured yet
  if (onboardingTipEl) {
    const needsSetup = !savedRepoHandle && aiController.getConfig().provider === 'none';
    if (needsSetup && chromeApi.storage?.local.get) {
      chromeApi.storage.local.get(ONBOARDING_DISMISSED_KEY, (res) => {
        if (!res?.[ONBOARDING_DISMISSED_KEY]) {
          onboardingTipEl.style.display = 'flex';
        }
      });
    }
    dismissOnboardingBtn?.addEventListener('click', () => {
      onboardingTipEl.style.display = 'none';
      chromeApi.storage?.local.set({ [ONBOARDING_DISMISSED_KEY]: true });
    });
  }

  const startRecordingClock = (startedAt: number) => {
    if (recordingTimerInterval !== null) clearInterval(recordingTimerInterval);
    const tick = () => {
      const elapsed = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
      setRecordBtnText(`⏹ Stop (${elapsed}s)`);
      if (recordAudioBtn) {
        recordAudioBtn.style.borderColor = '#ef4444';
        recordAudioBtn.style.color = '#fca5a5';
      }
    };
    tick();
    recordingTimerInterval = setInterval(tick, 1000);
  };

  const resetRecordButtonUi = () => {
    if (recordingTimerInterval !== null) {
      clearInterval(recordingTimerInterval);
      recordingTimerInterval = null;
    }
    isRecordingAudio = false;
    setRecordBtnText(activeVideo?.capturedAudio ? '🎙 Re-Record Audio' : '🎙 Record Audio');
    if (recordAudioBtn) {
      recordAudioBtn.style.borderColor = '';
      recordAudioBtn.style.color = '';
    }
  };

  const hydrateStoredMedia = (video: ActiveTabVideo, cb: () => void) => {
    if (!chromeApi.storage?.local.get) {
      cb();
      return;
    }
    chromeApi.storage.local.get(
      ['capturedFramesByVideo', 'capturedAudioByVideo', 'capturedFeedTitleById', 'activeReelRecording'],
      (res) => {
        const activeRec = res?.activeReelRecording;
        const feedTitleMap = (res as { capturedFeedTitleById?: Record<string, string> })
          ?.capturedFeedTitleById;
        const isDifferentFeedReel =
          video.videoId === 'ig-feed-active' &&
          (!activeRec || activeRec.videoId !== video.videoId) &&
          feedTitleMap?.[video.videoId] !== undefined &&
          feedTitleMap[video.videoId] !== video.title;

        if (!isDifferentFeedReel) {
          const savedFrames = res?.capturedFramesByVideo?.[video.videoId];
          if (Array.isArray(savedFrames) && savedFrames.length > 0) {
            video.capturedFrames = savedFrames;
          }
          const savedAudio = res?.capturedAudioByVideo?.[video.videoId];
          if (savedAudio?.dataUrl) {
            video.capturedAudio = savedAudio;
          }
        }
        if (activeRec && activeRec.videoId === video.videoId && activeRec.startedAt) {
          isRecordingAudio = true;
          startRecordingClock(activeRec.startedAt);
        } else {
          resetRecordButtonUi();
        }
        cb();
      }
    );
  };

  const persistVideoFrames = (videoId: string, frames: CapturedFrame[], videoTitle?: string) => {
    if (!chromeApi.storage?.local.get) return;
    chromeApi.storage.local.get(['capturedFramesByVideo', 'capturedFeedTitleById'], (res) => {
      const map = { ...(res?.capturedFramesByVideo || {}) };
      map[videoId] = frames.slice(0, MAX_STORED_FRAMES);
      const keys = Object.keys(map);
      while (keys.length > 6) {
        const oldest = keys.shift();
        if (oldest && oldest !== videoId) delete map[oldest];
      }
      const feedTitleMap = {
        ...((res as { capturedFeedTitleById?: Record<string, string> })?.capturedFeedTitleById || {}),
      };
      if (videoId === 'ig-feed-active' && videoTitle) {
        feedTitleMap[videoId] = videoTitle;
      }
      chromeApi.storage?.local.set({ capturedFramesByVideo: map, capturedFeedTitleById: feedTitleMap });
    });
  };

  const mergeUniqueFrames = (
    existing: CapturedFrame[],
    incoming: CapturedFrame[]
  ): CapturedFrame[] => {
    const merged = [...existing];
    for (const frame of incoming) {
      if (merged.length >= MAX_STORED_FRAMES) break;
      const dup = merged.some(
        (prev) =>
          (frame.source === 'video_canvas' &&
            prev.source === 'video_canvas' &&
            prev.timestampLabel === frame.timestampLabel) ||
          (prev.dataUrl.length === frame.dataUrl.length &&
            prev.dataUrl.slice(0, 128) === frame.dataUrl.slice(0, 128))
      );
      if (!dup) merged.push(frame);
    }
    return merged.slice(0, MAX_STORED_FRAMES);
  };

  const captureSingleVisibleFrame = (): Promise<CapturedFrame | null> =>
    new Promise((resolve) => {
      chromeApi.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB_FRAME' }, (tabRes) => {
        if (tabRes?.ok && tabRes.dataUrl) {
          void downscaleImageDataUrl(tabRes.dataUrl, 960, 0.78).then((compactUrl) => {
            resolve({
              id: `tab-${Date.now()}`,
              timestampSeconds: 0,
              timestampLabel: 'visible-tab',
              dataUrl: compactUrl,
              source: 'visible_tab',
            });
          });
        } else {
          resolve(null);
        }
      });
    });

  const autoCaptureStoryboardFromActiveTab = async (
    tabId: number,
    maxFrames = 12
  ): Promise<{ frames: CapturedFrame[]; errorMsg?: string }> => {
    const contentRes = await new Promise<{
      ok?: boolean;
      frames?: CapturedFrame[];
      taintedOrBlocked?: boolean;
      durationSeconds?: number;
      originalTime?: number;
      wasPaused?: boolean;
    } | null>((resolve) => {
      chromeApi.tabs.sendMessage(tabId, { type: 'AUTO_CAPTURE_STORYBOARD', maxFrames }, (res) => {
        void chromeApi.runtime.lastError;
        resolve(res || null);
      });
    });

    if (contentRes?.ok && Array.isArray(contentRes.frames) && contentRes.frames.length > 0) {
      return { frames: contentRes.frames.slice(0, MAX_STORED_FRAMES) };
    }

    // Automatic CORS fallback: seek <video> in DOM and capture visible tab (580ms spaced for Chromium cap)
    const duration = Number(contentRes?.durationSeconds || 0);
    if (contentRes?.taintedOrBlocked && duration > 0.5) {
      const targets = computeStoryboardTimestamps(duration, Math.min(6, maxFrames));
      const swept: CapturedFrame[] = [];
      let lastCapAt = 0;
      try {
        for (const secTarget of targets) {
          const seekRes = await new Promise<{
            ok?: boolean;
            timestampSeconds?: number;
            timestampLabel?: string;
          } | null>((resolve) => {
            chromeApi.tabs.sendMessage(
              tabId,
              { type: 'SEEK_VIDEO_TIMESTAMP', targetSeconds: secTarget },
              (r) => {
                void chromeApi.runtime.lastError;
                resolve(r || null);
              }
            );
          });
          if (!seekRes?.ok) continue;

          const waitMs = Math.max(0, 580 - (Date.now() - lastCapAt));
          if (waitMs > 0) {
            await new Promise((r) => setTimeout(r, waitMs));
          }
          lastCapAt = Date.now();
          const vis = await captureSingleVisibleFrame();
          if (vis) {
            const ts = seekRes.timestampSeconds ?? Math.floor(secTarget);
            swept.push({
              ...vis,
              id: `auto-tab-${swept.length + 1}-${ts}s-${Date.now()}`,
              timestampSeconds: ts,
              timestampLabel: seekRes.timestampLabel || formatSecondsToTimestamp(ts),
            });
          }
        }
      } finally {
        chromeApi.tabs.sendMessage(
          tabId,
          {
            type: 'RESTORE_VIDEO_STATE',
            targetSeconds: contentRes.originalTime ?? 0,
            resumePlay: !(contentRes.wasPaused ?? true),
          },
          () => {
            void chromeApi.runtime.lastError;
          }
        );
      }
      if (swept.length > 0) {
        return { frames: swept };
      }
    }

    const singleFallback = await new Promise<{ frame: CapturedFrame | null; errorMsg?: string }>(
      (resolve) => {
        chromeApi.tabs.sendMessage(tabId, { type: 'CAPTURE_VIDEO_FRAME' }, (res) => {
          void chromeApi.runtime.lastError;
          if (res?.ok && res.frame) {
            resolve({ frame: res.frame });
            return;
          }
          chromeApi.runtime.sendMessage({ type: 'CAPTURE_VISIBLE_TAB_FRAME' }, (tabRes) => {
            if (tabRes?.ok && tabRes.dataUrl) {
              void downscaleImageDataUrl(tabRes.dataUrl, 960, 0.78).then((compactUrl) => {
                resolve({
                  frame: {
                    id: `tab-${Date.now()}`,
                    timestampSeconds: 0,
                    timestampLabel: 'visible-tab',
                    dataUrl: compactUrl,
                    source: 'visible_tab',
                  },
                });
              });
            } else {
              resolve({ frame: null, errorMsg: tabRes?.error });
            }
          });
        });
      }
    );

    return singleFallback.frame
      ? { frames: [singleFallback.frame] }
      : { frames: [], errorMsg: singleFallback.errorMsg };
  };

  const applyDetectedVideo = (data?: ActiveTabVideo, diagnosticReason?: string) => {
    if (!data) {
      if (titleEl) titleEl.textContent = 'No YouTube video or Instagram Reel open';
      if (metaEl) {
        metaEl.textContent =
          'Open any YouTube video/Short or Instagram Reel (/reel/... or /reels/...), then click SkillLoom.';
      }
      setStatus(
        diagnosticReason || 'Waiting for a supported YouTube or Instagram Reel tab.',
        diagnosticReason ? 'error' : 'neutral'
      );
      return;
    }
    activeVideo = data;
    hydrateStoredMedia(activeVideo, () => {
      if (!activeVideo) return;
      if (titleEl) titleEl.textContent = activeVideo.title;
      const updateUiAndStatus = (overrideBanner?: string) => {
        if (!activeVideo) return;
        renderVideoSummary();
        const capCount = activeVideo.transcriptSegments?.length || 0;
        const frameCount = activeVideo.capturedFrames?.length || 0;
        const isIg = activeVideo.sourcePlatform === 'instagram';
        const previewPkg = buildBrowserSkillPackage(activeVideo);
        if (overrideBanner) {
          setStatus(overrideBanner, frameCount > 0 ? 'neutral' : 'error');
        } else if (capCount === 0 && previewPkg.coverageLevel === 'VISUAL_HEAVY_NEEDS_FRAMES') {
          setStatus(
            isIg
              ? `Auto-captured ${frameCount} frame(s) across Reel — ready for Install or Record Audio!`
              : 'No captions auto-loaded yet — Auto-Frames scanning or open YouTube transcript.',
            isIg && frameCount > 0 ? 'neutral' : 'error'
          );
        } else if (capCount === 0 && isIg) {
          setStatus(
            savedRepoHandle
              ? `Auto-captured Reel (${frameCount} frame(s)) ✓ Click "Install to ${savedRepoHandle.name}/" or "Copy Prompt".`
              : `Auto-captured Reel (${frameCount} frame(s)) ✓ Choose your Skills Repo (Plan A) or "Copy Prompt" (Plan B).`,
            'success'
          );
        } else if (previewPkg.coverageLevel === 'VISUAL_HEAVY_NEEDS_FRAMES') {
          setStatus(
            `Captured ${capCount} captions + ${frameCount} auto frame(s) — ready to Install or Copy Prompt.`
          );
        } else {
          setStatus(
            savedRepoHandle
              ? `Ready! Click "Install to ${savedRepoHandle.name}/" or Plan B: "Copy Prompt".`
              : `Ready! Choose your Skills Repo folder once (Plan A) or "Copy Prompt" (Plan B).`,
            'success'
          );
        }
        if (installRepoBtn) installRepoBtn.disabled = false;
        if (changeRepoBtn) changeRepoBtn.disabled = false;
        if (copyPromptBtn) copyPromptBtn.disabled = false;
        if (snapFrameBtn) snapFrameBtn.disabled = false;
        if (recordAudioBtn) recordAudioBtn.disabled = false;
        if (agentFolderBtn) agentFolderBtn.disabled = false;
        if (exportBtn) exportBtn.disabled = false;
        if (exportMdBtn) exportMdBtn.disabled = false;
      };

      updateUiAndStatus(diagnosticReason);

      // Automatically capture a multi-timestamp storyboard across the Reel / no-caption video
      const needsAutoStoryboard =
        activeTabId &&
        !isRecordingAudio &&
        (activeVideo.sourcePlatform === 'instagram' ||
          (activeVideo.transcriptSegments?.length || 0) === 0) &&
        (activeVideo.capturedFrames?.length || 0) < 2;

      if (needsAutoStoryboard && activeTabId) {
        setStatus('Auto-capturing keyframes across Reel timeline...', 'busy');
        activeAutoCapturePromise = autoCaptureStoryboardFromActiveTab(activeTabId, 12)
          .then(({ frames, errorMsg }) => {
            if (!activeVideo) return [];
            if (frames.length > 0) {
              const merged = mergeUniqueFrames(activeVideo.capturedFrames || [], frames);
              activeVideo.capturedFrames = merged;
              persistVideoFrames(activeVideo.videoId, merged, activeVideo.title);
              updateUiAndStatus(
                diagnosticReason
                  ? `Auto-captured ${merged.length} frame(s)! ${profile.label} blocked DOM text — click Install or Open Skill Studio → to paste caption.`
                  : undefined
              );
              return merged;
            }
            if (diagnosticReason && errorMsg) {
              setStatus(
                `${diagnosticReason} Meanwhile click "Open Skill Studio →" and paste caption/Ctrl+V screenshots (${errorMsg}).`,
                'error'
              );
            }
            return [];
          })
          .finally(() => {
            activeAutoCapturePromise = null;
          });
      }
    });
  };

  const runActiveTabScan = (
    tabId: number,
    tabUrl: string,
    tabTitle: string | undefined,
    detectorFile: string | null,
    isInstagramTab: boolean
  ) => {
    setStatus('Reading captions, description links & creator comments...', 'busy');
    chromeApi.tabs.sendMessage(tabId, { type: 'GET_ACTIVE_VIDEO' }, (res) => {
      const sendErr = chromeApi.runtime.lastError?.message;
      if (!sendErr && res?.ok) {
        if (grantSiteBtn) grantSiteBtn.style.display = 'none';
        applyDetectedVideo(res.data);
        return;
      }

      if (chromeApi.scripting?.executeScript && detectorFile) {
        chromeApi.scripting.executeScript(
          { target: { tabId }, files: [detectorFile] },
          () => {
            const injectErr = chromeApi.runtime.lastError?.message;
            if (injectErr) {
              const handleBlockedDiagnose = (grantedOrigins: string[]) => {
                const igGranted = grantedOrigins.some((o) => o.includes('instagram.com'));
                if (!igGranted && isInstagramTab && grantSiteBtn) {
                  grantSiteBtn.style.display = 'block';
                }
                const detail = !igGranted && isInstagramTab
                  ? `${profile.label} withheld instagram.com permission (${injectErr}). Click "Allow Instagram Access & Retry" above.`
                  : `${profile.label} blocked DOM access (${injectErr}) — check Site access for instagram.com.`;
                const igFallback = isInstagramTab
                  ? (buildFallbackInstagramVideoFromTab(tabUrl, tabTitle) as ActiveTabVideo | null)
                  : null;
                applyDetectedVideo(igFallback ?? undefined, detail);
              };

              if (chromeApi.permissions?.getAll) {
                chromeApi.permissions.getAll((perms) => {
                  handleBlockedDiagnose(perms?.origins || []);
                });
              } else {
                handleBlockedDiagnose([]);
              }
              return;
            }
            if (grantSiteBtn) grantSiteBtn.style.display = 'none';
            chromeApi.tabs.sendMessage(tabId, { type: 'GET_ACTIVE_VIDEO' }, (retryRes) => {
              const retryErr = chromeApi.runtime.lastError?.message;
              const typedRetry = retryRes as { ok?: boolean; data?: ActiveTabVideo; reason?: string } | undefined;
              const igFallback =
                !typedRetry?.ok && isInstagramTab
                  ? (buildFallbackInstagramVideoFromTab(tabUrl, tabTitle) as ActiveTabVideo | null)
                  : null;
              applyDetectedVideo(
                typedRetry?.ok ? typedRetry.data : (igFallback ?? undefined),
                typedRetry?.ok
                  ? undefined
                  : retryErr || typedRetry?.reason || `Could not extract content on ${tabUrl}.`
              );
            });
          }
        );
      } else {
        applyDetectedVideo(
          undefined,
          res && !res.ok
            ? (res as { reason?: string }).reason
            : sendErr && !tabUrl
              ? `Unsupported or protected tab (${sendErr}).`
              : undefined
        );
      }
    });
  };

  chromeApi.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    const tabId = tab?.id;
    if (!tabId) return;
    activeTabId = tabId;

    const tabUrl = tab?.url || '';
    const tabTitle = tab?.title;
    const isInstagramTab = /^https:\/\/(?:[a-z0-9-]+\.)?instagram\.com\//i.test(tabUrl);
    const isYouTubeTab = /^https:\/\/(?:[a-z0-9-]+\.)?youtube\.com\//i.test(tabUrl);
    const detectorFile = isInstagramTab
      ? 'content/instagram-detector.js'
      : isYouTubeTab
        ? 'content/youtube-detector.js'
        : null;

    grantSiteBtn?.addEventListener('click', async () => {
      if (!chromeApi.permissions?.request) {
        setStatus(`Open ${extensionsUrl} → SkillLoom → Details → Site access and enable instagram.com.`, 'error');
        return;
      }
      try {
        const granted = await new Promise<boolean>((resolve) => {
          const maybePromise = chromeApi.permissions!.request!(
            { origins: ['https://www.instagram.com/*', 'https://instagram.com/*'] },
            (ok) => resolve(Boolean(ok))
          );
          if (maybePromise && typeof (maybePromise as Promise<boolean>).then === 'function') {
            (maybePromise as Promise<boolean>).then((ok) => resolve(Boolean(ok))).catch(() => resolve(false));
          }
        });
        if (granted) {
          runActiveTabScan(tabId, tabUrl, tabTitle, detectorFile, isInstagramTab);
        } else {
          setStatus(
            `Permission denied/withheld by ${profile.label} — open ${extensionsUrl} → SkillLoom → Details → Site access and allow instagram.com.`,
            'error'
          );
        }
      } catch {
        setStatus(
          `${profile.label} blocked automatic request — open ${extensionsUrl} → SkillLoom → Details → Site access (enable instagram.com).`,
          'error'
        );
      }
    });

    runActiveTabScan(tabId, tabUrl, tabTitle, detectorFile, isInstagramTab);
  });

  snapFrameBtn?.addEventListener('click', () => {
    if (!activeVideo || !activeTabId || !snapFrameBtn) return;
    snapFrameBtn.disabled = true;
    setStatus('Auto-capturing storyboard frames across video...', 'busy');

    activeAutoCapturePromise = autoCaptureStoryboardFromActiveTab(activeTabId, 12)
      .then(({ frames, errorMsg }) => {
        if (!activeVideo || frames.length === 0) {
          setStatus(errorMsg || 'Could not auto-capture frames from active tab.', 'error');
          return [];
        }
        const next = frames.slice(0, MAX_STORED_FRAMES);
        activeVideo.capturedFrames = next;
        persistVideoFrames(activeVideo.videoId, next, activeVideo.title);
        renderVideoSummary();
        setStatus(
          `Auto-captured ${next.length} frame(s) across timeline! Ready to Install or Copy Prompt.`,
          'success'
        );
        return next;
      })
      .finally(() => {
        activeAutoCapturePromise = null;
        snapFrameBtn.disabled = false;
      });
  });

  recordAudioBtn?.addEventListener('click', () => {
    if (!activeVideo || !activeTabId || !recordAudioBtn) return;

    if (isRecordingAudio) {
      recordAudioBtn.disabled = true;
      setStatus('Saving Reel audio + captured slides...', 'busy');
      chromeApi.runtime.sendMessage({ type: 'STOP_REEL_AUDIO_CAPTURE' }, (res) => {
        recordAudioBtn.disabled = false;
        const typed = res as {
          ok?: boolean;
          silentAudio?: boolean;
          audio?: { dataUrl: string; durationSeconds: number; mimeType?: string };
          error?: string;
        } | undefined;
        resetRecordButtonUi();
        if (typed?.silentAudio && activeVideo) {
          activeVideo.capturedAudio = undefined;
          hydrateStoredMedia(activeVideo, () => {
            renderVideoSummary();
            setStatus(
              `Captured silent audio only (${activeVideo?.capturedFrames?.length || 0} slide(s) saved). Unmute 🔊 & play the Reel, then click Re-Record — or Install using screenshots/caption.`,
              'error'
            );
          });
          return;
        }
        if (!typed?.ok || !typed.audio || !activeVideo) {
          setStatus(typed?.error || 'Audio recording stopped without data.', 'error');
          return;
        }
        activeVideo.capturedAudio = typed.audio;
        hydrateStoredMedia(activeVideo, () => {
          renderVideoSummary();
          const hasByok = (aiController?.getConfig()?.provider || 'none') !== 'none';
          setStatus(
            hasByok
              ? `Recorded ${typed.audio!.durationSeconds}s audio + ${activeVideo?.capturedFrames?.length || 0} slide(s)! Click Install or Copy Prompt for deep BYOK synthesis.`
              : `Recorded ${typed.audio!.durationSeconds}s audio + ${activeVideo?.capturedFrames?.length || 0} slide(s)! Pick Gemini/Groq in the AI pill above so Install auto-transcribes & expands it!`,
            'success'
          );
        });
      });
      return;
    }

    if (!chromeApi.tabCapture?.getMediaStreamId) {
      setStatus('Tab audio capture unavailable in this browser.', 'error');
      return;
    }
    recordAudioBtn.disabled = true;
    setStatus('Starting tab audio + slide sweep...', 'busy');

    // Keep tabCapture synchronously inside user-gesture stack; try unmuting/playing in parallel
    let videoPlaybackState: { ok?: boolean; muted?: boolean; paused?: boolean } = {};
    chromeApi.tabs.sendMessage(activeTabId, { type: 'PREPARE_VIDEO_FOR_AUDIO' }, (prepRes) => {
      void chromeApi.runtime.lastError;
      if (prepRes && typeof prepRes === 'object') {
        videoPlaybackState = prepRes as { ok?: boolean; muted?: boolean; paused?: boolean };
      }
    });

    chromeApi.tabCapture.getMediaStreamId({ targetTabId: activeTabId }, (streamId) => {
      const capErr = chromeApi.runtime.lastError?.message;
      if (capErr || !streamId || !activeVideo || !activeTabId) {
        recordAudioBtn.disabled = false;
        setStatus(capErr || 'Could not start tab audio capture on this tab.', 'error');
        return;
      }

      if (activeVideo.videoId === 'ig-feed-active' && chromeApi.storage?.local.set) {
        // Persist current feed title so sweep frames belong strictly to this active Reel
        persistVideoFrames(activeVideo.videoId, activeVideo.capturedFrames || [], activeVideo.title);
      }

      chromeApi.runtime.sendMessage(
        {
          type: 'START_REEL_AUDIO_CAPTURE',
          tabId: activeTabId,
          videoId: activeVideo.videoId,
          streamId,
          maxMs:
            activeVideo.durationSeconds > 0
              ? Math.min(90000, Math.max(15000, (activeVideo.durationSeconds + 2) * 1000))
              : 90000,
        },
        (res) => {
          recordAudioBtn.disabled = false;
          if (!res?.ok) {
            setStatus(res?.error || 'Offscreen audio recorder failed to start.', 'error');
            return;
          }
          isRecordingAudio = true;
          startRecordingClock(Date.now());
          const hint =
            videoPlaybackState.muted
              ? 'Unmute 🔊 & press Play ▶ on the Reel, then reopen & click Stop!'
              : videoPlaybackState.paused !== false
                ? 'Press Play ▶ on the Reel (make sure sound is on), then reopen & click Stop.'
                : 'Recording Reel audio + slides! Keep Reel unmuted, then reopen & click Stop when done.';
          setStatus(hint, videoPlaybackState.muted ? 'neutral' : 'success');
        }
      );
    });
  });

  const launchStudio = async (action?: 'chooseRepo' | 'installRepo') => {
    if (!activeVideo) return;
    if (activeAutoCapturePromise) {
      setStatus('Finishing automatic keyframe capture...', 'busy');
      try {
        await activeAutoCapturePromise;
      } catch {
        // Proceed cleanly
      }
    }
    if (chromeApi.storage?.local && chromeApi.tabs.create && chromeApi.runtime.getURL) {
      chromeApi.storage.local.set({ pendingAgentBundle: activeVideo }, () => {
        const base = chromeApi.runtime.getURL!('popup/handoff.html');
        chromeApi.tabs.create!({ url: action ? `${base}?action=${action}` : base });
      });
      return;
    }
    const pkg = buildBrowserSkillPackage(activeVideo);
    triggerBinaryDownload(pkg.zipFilename, pkg.zipBytes, 'application/zip');
    setStatus(`Downloaded ${pkg.zipFilename} (${pkg.files.length} skill files).`, 'success');
  };

  installRepoBtn?.addEventListener('click', async () => {
    if (!activeVideo || !installRepoBtn) return;
    if (!savedRepoHandle) {
      launchStudio('chooseRepo');
      return;
    }
    const permState = savedRepoHandle.queryPermission
      ? await savedRepoHandle.queryPermission({ mode: 'readwrite' }).catch(() => 'prompt')
      : 'granted';
    if (permState !== 'granted') {
      launchStudio('installRepo');
      return;
    }

    installRepoBtn.disabled = true;
    try {
      const { pkg, distillNote } = await buildAndAutoDistill(activeVideo);
      if (!pkg.qualityReport.structuralPassed) {
        setStatus(
          `Blocked by Quality Gate (${pkg.qualityReport.score}/100): ${pkg.qualityReport.structuralIssues[0] || 'Structural safety check failed.'}`,
          'error'
        );
        return;
      }
      const installed = await installSkillPackageToDirectoryHandle(pkg, savedRepoHandle);
      const skippedAi = Boolean(distillNote && /^AI distill skipped/i.test(distillNote));
      const draftTag = pkg.qualityReport.grade === 'DRAFT' ? ` [Draft ${pkg.qualityReport.score}/100]` : ` [${pkg.qualityReport.score}/100]`;
      setStatus(
        `${distillNote ? `${distillNote} ` : ''}Installed ${installed.fileCount} files${draftTag} into ${installed.installedPath}!`,
        skippedAi ? 'error' : 'success'
      );
    } catch (err: unknown) {
      setStatus(
        `Could not write directly to saved repo (${err instanceof Error ? err.message : 'locked'}). Opening Skill Studio...`,
        'error'
      );
      launchStudio('installRepo');
    } finally {
      installRepoBtn.disabled = false;
    }
  });

  changeRepoBtn?.addEventListener('click', () => {
    launchStudio('chooseRepo');
  });

  agentFolderBtn?.addEventListener('click', () => {
    launchStudio();
  });

  copyPromptBtn?.addEventListener('click', async () => {
    if (!activeVideo || !copyPromptBtn) return;
    copyPromptBtn.disabled = true;
    try {
      const { pkg, distillNote } = await buildAndAutoDistill(activeVideo);
      await navigator.clipboard.writeText(pkg.agentEvalPrompt);
      setStatus(
        `${distillNote ? `${distillNote} ` : ''}Copied "${pkg.slug}" (${pkg.extractedArtifactCount} cmds/prompts, ${pkg.capturedFrameCount} frames) to clipboard!`,
        'success'
      );
    } catch {
      const fallback = buildBrowserSkillPackage(activeVideo);
      triggerBinaryDownload(fallback.zipFilename, fallback.zipBytes, 'application/zip');
      setStatus(`Clipboard blocked — downloaded ${fallback.zipFilename} instead.`);
    } finally {
      copyPromptBtn.disabled = false;
    }
  });

  exportBtn?.addEventListener('click', async () => {
    if (!activeVideo || !exportBtn) return;
    exportBtn.disabled = true;
    try {
      const { pkg, distillNote } = await buildAndAutoDistill(activeVideo);
      triggerBinaryDownload(pkg.zipFilename, pkg.zipBytes, 'application/zip');
      setStatus(
        `${distillNote ? `${distillNote} ` : ''}Downloaded ${pkg.zipFilename} (${pkg.files.length} files).`,
        'success'
      );
    } finally {
      exportBtn.disabled = false;
    }
  });

  exportMdBtn?.addEventListener('click', async () => {
    if (!activeVideo || !exportMdBtn) return;
    exportMdBtn.disabled = true;
    try {
      const { pkg, distillNote } = await buildAndAutoDistill(activeVideo);
      const mdBytes = new TextEncoder().encode(pkg.files[0]?.content || '');
      triggerBinaryDownload(`${pkg.slug}-SKILL.md`, mdBytes, 'text/markdown;charset=utf-8');
      setStatus(
        `${distillNote ? `${distillNote} ` : ''}Downloaded ${pkg.slug}-SKILL.md!`,
        'success'
      );
    } finally {
      exportMdBtn.disabled = false;
    }
  });
}

initPopup();
