/**
 * SkillLoom Chromium MV3 Background Service Worker
 * Pure extension-only local background worker: handles offscreen tab-audio recording,
 * slide frame capture, visible-tab screenshot capture, and launching Skill Studio.
 * Strictly requires explicit user action before any visible-tab frame sampling.
 */

interface ChromeLike {
  runtime: {
    getURL?: (path: string) => string;
    sendMessage?: (msg: unknown, cb?: (res: unknown) => void) => void;
    lastError?: { message?: string };
    onMessage: {
      addListener: (
        fn: (
          message: {
            type: string;
            payload?: unknown;
            tabId?: number;
            videoId?: string;
            streamId?: string;
            maxMs?: number;
          },
          sender: unknown,
          sendResponse: (res: unknown) => void
        ) => boolean | void
      ) => void;
    };
  };
  offscreen?: {
    hasDocument?: () => Promise<boolean>;
    createDocument: (opts: {
      url: string;
      reasons: string[];
      justification: string;
    }) => Promise<void>;
    closeDocument?: () => Promise<void>;
  };
  storage?: {
    local: {
      get: (key: string, cb: (res: Record<string, unknown>) => void) => void;
      set: (items: Record<string, unknown>, cb?: () => void) => void;
    };
  };
  tabs?: {
    create?: (opts: { url: string }) => void;
    get?: (
      tabId: number,
      cb: (tab?: { id?: number; active?: boolean; windowId?: number; url?: string }) => void
    ) => void;
    sendMessage?: (tabId: number, msg: unknown, cb?: (res: unknown) => void) => void;
    captureVisibleTab: (
      windowId: number | undefined,
      options: { format: 'jpeg'; quality: number },
      cb: (dataUrl: string) => void
    ) => void;
  };
}

let activeSlideSweepTimer: ReturnType<typeof setInterval> | null = null;
let initialSweepDelayTimer: ReturnType<typeof setTimeout> | null = null;

function stopSlideSweepTimer(): void {
  if (initialSweepDelayTimer !== null) {
    clearTimeout(initialSweepDelayTimer);
    initialSweepDelayTimer = null;
  }
  if (activeSlideSweepTimer !== null) {
    clearInterval(activeSlideSweepTimer);
    activeSlideSweepTimer = null;
  }
}

async function ensureOffscreenRecorderDoc(chromeApi: ChromeLike): Promise<void> {
  if (!chromeApi.offscreen?.createDocument) {
    throw new Error('Offscreen recording API unavailable in this browser.');
  }
  const hasDoc = chromeApi.offscreen.hasDocument
    ? await chromeApi.offscreen.hasDocument().catch(() => false)
    : false;
  if (hasDoc) return;
  try {
    await chromeApi.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['USER_MEDIA'],
      justification: 'Capture active tutorial tab audio locally for AI skill transcription.',
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '';
    if (!/single offscreen/i.test(msg)) throw err;
  }
}

function persistRecordedAudio(
  chromeApi: ChromeLike,
  videoId: string,
  audio: { dataUrl: string; durationSeconds: number; mimeType: string; capturedAt: number }
): Promise<void> {
  return new Promise((resolve) => {
    if (!chromeApi.storage?.local || !audio.dataUrl) {
      resolve();
      return;
    }
    chromeApi.storage.local.get('capturedAudioByVideo', (res) => {
      const map = { ...((res?.capturedAudioByVideo || {}) as Record<string, unknown>) };
      map[videoId] = audio;
      const keys = Object.keys(map);
      if (keys.length > 3) {
        delete map[keys[0]];
      }
      chromeApi.storage!.local.set({ capturedAudioByVideo: map, activeReelRecording: null }, () =>
        resolve()
      );
    });
  });
}

function sampleTabSlideFrame(chromeApi: ChromeLike, tabId: number, videoId: string): void {
  if (!chromeApi.storage?.local) return;
  const saveFrame = (frame: {
    id: string;
    timestampSeconds: number;
    timestampLabel: string;
    dataUrl: string;
    source: string;
  }) => {
    chromeApi.storage!.local.get('capturedFramesByVideo', (res) => {
      const map = { ...((res?.capturedFramesByVideo || {}) as Record<string, Array<{
        timestampLabel?: string;
        dataUrl?: string;
      }>>) };
      const existing = Array.isArray(map[videoId]) ? [...map[videoId]] : [];
      if (existing.length >= 6) return;

      const duplicateFrame = existing.some((prev) => {
        if (
          frame.source === 'video_canvas' &&
          prev.timestampLabel &&
          prev.timestampLabel === frame.timestampLabel
        ) {
          return true;
        }
        return (
          typeof prev.dataUrl === 'string' &&
          prev.dataUrl.length === frame.dataUrl.length &&
          prev.dataUrl.slice(0, 128) === frame.dataUrl.slice(0, 128)
        );
      });
      if (duplicateFrame) return;

      existing.push(frame);
      map[videoId] = existing;
      const keys = Object.keys(map);
      while (keys.length > 6) {
        const oldest = keys.shift();
        if (oldest && oldest !== videoId) {
          delete map[oldest];
        }
      }
      chromeApi.storage!.local.set({ capturedFramesByVideo: map });
    });
  };

  if (chromeApi.tabs?.sendMessage) {
    chromeApi.tabs.sendMessage(tabId, { type: 'CAPTURE_VIDEO_FRAME' }, (res) => {
      void chromeApi.runtime.lastError;
      const typed = res as { ok?: boolean; frame?: { id: string; timestampSeconds: number; timestampLabel: string; dataUrl: string; source: string } } | undefined;
      if (typed?.ok && typed.frame) {
        saveFrame(typed.frame);
        return;
      }
      const captureActiveTutorialTab = (targetWindowId?: number) => {
        chromeApi.tabs?.captureVisibleTab(targetWindowId, { format: 'jpeg', quality: 68 }, (dataUrl) => {
          if (chromeApi.runtime.lastError || !dataUrl) return;
          saveFrame({
            id: `sweep-${Date.now()}`,
            timestampSeconds: 0,
            timestampLabel: `slide-${Math.floor((Date.now() / 1000) % 60)}s`,
            dataUrl,
            source: 'visible_tab',
          });
        });
      };
      if (chromeApi.tabs?.captureVisibleTab) {
        if (chromeApi.tabs.get) {
          chromeApi.tabs.get(tabId, (tab) => {
            if (
              chromeApi.runtime.lastError ||
              !tab?.active ||
              !/^https:\/\/(?:[a-z0-9-]+\.)?(?:instagram\.com|youtube\.com)\//i.test(tab.url || '')
            ) {
              return;
            }
            captureActiveTutorialTab(tab.windowId);
          });
        } else {
          captureActiveTutorialTab(undefined);
        }
      }
    });
  }
}

const chromeApi = (globalThis as { chrome?: ChromeLike }).chrome;
if (chromeApi?.runtime?.onMessage) {
  chromeApi.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'START_REEL_AUDIO_CAPTURE' && message.streamId && message.videoId && message.tabId) {
      const { streamId, videoId, tabId, maxMs } = message;
      ensureOffscreenRecorderDoc(chromeApi)
        .then(() => {
          chromeApi.runtime.sendMessage?.(
            {
              target: 'offscreen',
              type: 'OFFSCREEN_START_RECORDING',
              streamId,
              videoId,
              maxMs: maxMs || 90000,
            },
            (res) => {
              const typed = res as { ok?: boolean; error?: string } | undefined;
              if (!typed?.ok) {
                sendResponse({ ok: false, error: typed?.error || 'Offscreen start failed.' });
                return;
              }
              chromeApi.storage?.local.set({
                activeReelRecording: { videoId, tabId, startedAt: Date.now() },
              });
              // Give user ~1.8s to click Play on Reel, then sweep up to 6 distinct slides every 5s
              stopSlideSweepTimer();
              initialSweepDelayTimer = setTimeout(() => {
                sampleTabSlideFrame(chromeApi, tabId, videoId);
              }, 1800);
              activeSlideSweepTimer = setInterval(() => {
                sampleTabSlideFrame(chromeApi, tabId, videoId);
              }, 5000);
              sendResponse({ ok: true });
            }
          );
        })
        .catch((err: unknown) =>
          sendResponse({
            ok: false,
            error: err instanceof Error ? err.message : 'Unable to initialize audio recorder.',
          })
        );
      return true;
    }

    if (message.type === 'STOP_REEL_AUDIO_CAPTURE') {
      stopSlideSweepTimer();
      chromeApi.runtime.sendMessage?.(
        { target: 'offscreen', type: 'OFFSCREEN_STOP_RECORDING' },
        (res) => {
          const typed = res as {
            ok?: boolean;
            videoId?: string;
            audioDataUrl?: string;
            durationSeconds?: number;
            mimeType?: string;
            hasAudibleAudio?: boolean;
            byteLength?: number;
            error?: string;
          } | undefined;
          chromeApi.offscreen?.closeDocument?.().catch(() => {});
          if (!typed?.ok || !typed.audioDataUrl || !typed.videoId) {
            chromeApi.storage?.local.set({ activeReelRecording: null });
            sendResponse({ ok: false, error: typed?.error || 'Audio capture empty.' });
            return;
          }
          if (typed.hasAudibleAudio === false) {
            chromeApi.storage?.local.set({ activeReelRecording: null });
            sendResponse({
              ok: true,
              silentAudio: true,
              videoId: typed.videoId,
              byteLength: typed.byteLength || 0,
              durationSeconds: typed.durationSeconds || 1,
            });
            return;
          }
          const audioObj = {
            dataUrl: typed.audioDataUrl,
            durationSeconds: typed.durationSeconds || 1,
            mimeType: typed.mimeType || 'audio/webm',
            capturedAt: Date.now(),
          };
          persistRecordedAudio(chromeApi, typed.videoId, audioObj).then(() => {
            sendResponse({ ok: true, videoId: typed.videoId, audio: audioObj });
          });
        }
      );
      return true;
    }

    if (message.type === 'OFFSCREEN_RECORDING_COMPLETE' && message.payload) {
      stopSlideSweepTimer();
      const p = message.payload as {
        videoId?: string;
        audioDataUrl?: string;
        durationSeconds?: number;
        mimeType?: string;
        hasAudibleAudio?: boolean;
      };
      chromeApi.offscreen?.closeDocument?.().catch(() => {});
      if (p.videoId && p.audioDataUrl && p.hasAudibleAudio !== false) {
        void persistRecordedAudio(chromeApi, p.videoId, {
          dataUrl: p.audioDataUrl,
          durationSeconds: p.durationSeconds || 1,
          mimeType: p.mimeType || 'audio/webm',
          capturedAt: Date.now(),
        });
      } else {
        chromeApi.storage?.local.set({ activeReelRecording: null });
      }
      return false;
    }
    if (message.type === 'OPEN_SKILL_STUDIO' && message.payload) {
      const videoPayload = message.payload as Record<string, unknown> & {
        sourcePlatform?: string;
        videoId?: string;
        capturedFrames?: unknown[];
        capturedAudio?: unknown;
      };
      const openStudio = (finalPayload: unknown) => {
        const studioUrl = chromeApi.runtime.getURL?.('popup/handoff.html');
        if (!chromeApi.storage?.local || !chromeApi.tabs?.create || !studioUrl) {
          sendResponse({ ok: false, error: 'Skill Studio launch API unavailable.' });
          return;
        }
        chromeApi.storage.local.set({ pendingAgentBundle: finalPayload }, () => {
          chromeApi.tabs!.create!({ url: studioUrl });
          sendResponse({ ok: true });
        });
      };

      const senderTab = (sender as { tab?: { id?: number; windowId?: number } } | undefined)?.tab;
      const maybeCaptureFallbackAndOpen = async () => {
        if (
          videoPayload.sourcePlatform === 'instagram' &&
          (!Array.isArray(videoPayload.capturedFrames) || videoPayload.capturedFrames.length === 0) &&
          chromeApi.tabs?.captureVisibleTab
        ) {
          const duration = Number((videoPayload as { durationSeconds?: number }).durationSeconds || 0);
          if (senderTab?.id && duration > 0.8 && chromeApi.tabs.sendMessage) {
            const targets = [0.1, 0.35, 0.62, 0.86]
              .map((f) => Math.max(0.3, Math.min(duration - 0.35, Math.round(duration * f * 10) / 10)))
              .filter((v, i, a) => i === 0 || Math.abs(v - a[i - 1]) >= 0.4);
            const swept: unknown[] = [];
            let lastCap = 0;
            try {
              for (const targetSeconds of targets) {
                const seekOk = await new Promise<boolean>((resolve) => {
                  chromeApi.tabs!.sendMessage!(
                    senderTab.id!,
                    { type: 'SEEK_VIDEO_TIMESTAMP', targetSeconds },
                    (r) => {
                      void chromeApi.runtime.lastError;
                      resolve(Boolean((r as { ok?: boolean } | undefined)?.ok));
                    }
                  );
                });
                if (!seekOk) continue;
                const waitMs = Math.max(0, 580 - (Date.now() - lastCap));
                if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
                lastCap = Date.now();
                const shot = await new Promise<string | null>((resolve) => {
                  chromeApi.tabs!.captureVisibleTab(
                    senderTab.windowId,
                    { format: 'jpeg', quality: 68 },
                    (dataUrl) => {
                      resolve(chromeApi.runtime.lastError || !dataUrl ? null : dataUrl);
                    }
                  );
                });
                if (shot) {
                  const sec = Math.max(0, Math.floor(targetSeconds));
                  swept.push({
                    id: `ig-auto-${swept.length + 1}-${Date.now()}`,
                    timestampSeconds: sec,
                    timestampLabel: `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`,
                    dataUrl: shot,
                    note: 'Auto-captured Instagram Reel frame',
                    source: 'visible_tab',
                  });
                }
              }
            } finally {
              chromeApi.tabs.sendMessage(
                senderTab.id,
                { type: 'RESTORE_VIDEO_STATE', targetSeconds: 0, resumePlay: false },
                () => {
                  void chromeApi.runtime.lastError;
                }
              );
            }
            if (swept.length > 0) {
              videoPayload.capturedFrames = swept;
              openStudio(videoPayload);
              return;
            }
          }

          chromeApi.tabs.captureVisibleTab(senderTab?.windowId, { format: 'jpeg', quality: 70 }, (dataUrl) => {
            if (!chromeApi.runtime.lastError && dataUrl) {
              videoPayload.capturedFrames = [
                {
                  id: `ig-tab-${Date.now()}`,
                  timestampSeconds: 0,
                  timestampLabel: '00:00',
                  dataUrl,
                  note: 'Auto-captured Instagram Reel frame',
                  source: 'visible_tab',
                },
              ];
            }
            openStudio(videoPayload);
          });
          return;
        }
        openStudio(videoPayload);
      };

      if (videoPayload.videoId && videoPayload.videoId !== 'ig-feed-active' && chromeApi.storage?.local.get) {
        chromeApi.storage.local.get('capturedFramesByVideo', (res) => {
          const map = (res?.capturedFramesByVideo || {}) as Record<string, unknown[]>;
          const saved = map[videoPayload.videoId!];
          if (
            Array.isArray(saved) &&
            saved.length > 0 &&
            (!Array.isArray(videoPayload.capturedFrames) || videoPayload.capturedFrames.length === 0)
          ) {
            videoPayload.capturedFrames = saved;
          }
          chromeApi.storage!.local.get('capturedAudioByVideo', (audioRes) => {
            const audioMap = (audioRes?.capturedAudioByVideo || {}) as Record<string, unknown>;
            const savedAudio = audioMap[videoPayload.videoId!];
            if (savedAudio && !videoPayload.capturedAudio) {
              videoPayload.capturedAudio = savedAudio;
            }
            maybeCaptureFallbackAndOpen();
          });
        });
      } else {
        maybeCaptureFallbackAndOpen();
      }
      return true;
    }

    if (message.type === 'CAPTURE_VISIBLE_TAB_FRAME') {
      if (!chromeApi?.tabs?.captureVisibleTab) {
        sendResponse({ ok: false, error: 'Tab capture API unavailable.' });
        return false;
      }
      chromeApi.tabs.captureVisibleTab(undefined, { format: 'jpeg', quality: 75 }, (dataUrl) => {
        if (chromeApi.runtime.lastError || !dataUrl) {
          sendResponse({
            ok: false,
            error: chromeApi.runtime.lastError?.message || 'Unable to capture tab screenshot.',
          });
          return;
        }
        sendResponse({ ok: true, dataUrl });
      });
      return true;
    }

    return false;
  });
}
