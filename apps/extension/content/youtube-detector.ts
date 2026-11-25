/**
 * SkillLoom Chrome/Edge Content Script for https://www.youtube.com/watch*
 * Strictly uses permitted browser-visible DOM metadata and legitimately accessible
 * YouTube caption/transcript information. Never bypasses DRM or protected streams.
 */

import {
  autoCaptureVideoStoryboard,
  captureVideoFrameFromElement,
  type CapturedVideoFrame,
  type DetectedVideoContext,
  extractLabeledLinksFromContainer,
  formatSecondsToTimestamp,
  type LabeledReferenceLink,
  seekVideoElement,
} from '../lib/dom-extract-utils';

export type { CapturedVideoFrame, LabeledReferenceLink };
export type DetectedYouTubeContext = DetectedVideoContext;

function extractPinnedOrCreatorComment(
  doc: Document
): { pinnedComment?: DetectedYouTubeContext['pinnedComment']; links: LabeledReferenceLink[] } {
  const threads = Array.from(doc.querySelectorAll('ytd-comment-thread-renderer'));
  if (threads.length === 0) return { links: [] };

  const selectedThread =
    threads.find(
      (t) =>
        Boolean(t.querySelector('ytd-pinned-comment-badge-renderer')) ||
        Boolean(t.querySelector('#pinned-comment-badge')) ||
        Boolean(t.querySelector('ytd-author-comment-badge-renderer'))
    ) || threads[0];

  const isPinned = Boolean(
    selectedThread.querySelector('ytd-pinned-comment-badge-renderer, #pinned-comment-badge')
  );
  const isCreator = Boolean(
    selectedThread.querySelector('ytd-author-comment-badge-renderer, #author-comment-badge')
  );
  if (!isPinned && !isCreator) {
    // Only pull unpinned top comment if it contains links/code/actionable length
    const previewText = selectedThread.querySelector('#content-text')?.textContent?.trim() || '';
    if (previewText.length < 60 || (!/https?:\/\/|```|step\s+\d/i.test(previewText))) {
      return { links: [] };
    }
  }

  const contentEl = selectedThread.querySelector('#content-text') as HTMLElement | null;
  const text = (contentEl?.innerText || contentEl?.textContent || '').trim().slice(0, 4000);
  if (!text) return { links: [] };

  const author = (selectedThread.querySelector('#author-text')?.textContent || 'Creator').trim();
  const links = extractLabeledLinksFromContainer(contentEl, text, 'pinned_comment', 'youtube');
  return {
    pinnedComment: { author, text, isCreator: isCreator || isPinned },
    links,
  };
}

function parseTimestampToSeconds(label: string): number {
  const parts = label
    .trim()
    .split(':')
    .map((p) => Number(p));
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

export function extractVisibleYouTubeContext(doc: Document, loc: Location): DetectedYouTubeContext | null {
  const url = new URL(loc.href);
  let videoId = url.searchParams.get('v');
  if (!videoId && url.pathname.startsWith('/shorts/')) {
    videoId = url.pathname.split('/')[2] || null;
  }
  if (!videoId || !/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) {
    return null;
  }

  const titleEl =
    doc.querySelector('h1.ytd-watch-metadata yt-formatted-string') ||
    doc.querySelector('h1.title') ||
    doc.querySelector('meta[name="title"]');
  const title =
    (titleEl?.textContent || titleEl?.getAttribute('content') || doc.title.replace(/\s*-\s*YouTube$/, '')).trim();

  const channelEl =
    doc.querySelector('ytd-channel-name a') ||
    doc.querySelector('#owner-name a') ||
    doc.querySelector('link[itemprop="name"]');
  const channelName = (channelEl?.textContent || channelEl?.getAttribute('content') || 'Unknown Channel').trim();

  const videoEl = doc.querySelector('video');
  const durationSeconds = videoEl && Number.isFinite(videoEl.duration) ? Math.round(videoEl.duration) : 0;

  const descriptionContainer = doc.querySelector('#description-inline-expander') as HTMLElement | null;
  const metaDesc = doc.querySelector('meta[name="description"]');
  const rawDescription =
    descriptionContainer?.innerText ||
    descriptionContainer?.textContent ||
    metaDesc?.getAttribute('content') ||
    '';
  const cleanedRawDesc = rawDescription
    .replace(/\r\n/g, '\n')
    .replace(
      /\n(?:Résumé|Posez une question|Ask about this video|Chapitres\s*\n\s*Tout afficher|Chapters\s*\n\s*View all|Transcription\s*\n\s*Suivez la vidéo|Transcript\s*\n\s*Follow along)[\s\S]*$/i,
      ''
    )
    .trim();
  const description = cleanedRawDesc.slice(0, 12000);
  const descLinks = extractLabeledLinksFromContainer(
    descriptionContainer,
    description,
    'description',
    'youtube'
  );
  const { pinnedComment, links: commentLinks } = extractPinnedOrCreatorComment(doc);

  const labeledLinks: LabeledReferenceLink[] = [];
  const seenUrls = new Set<string>();
  for (const item of [...commentLinks, ...descLinks]) {
    if (seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    labeledLinks.push(item);
    if (labeledLinks.length >= 16) break;
  }

  // Check for DRM / encrypted media playback on the HTML5 video element
  const isDrmProtected = Boolean(videoEl && (videoEl as HTMLVideoElement & { mediaKeys?: unknown }).mediaKeys);

  // Read browser-visible transcript panel segments when open / legitimately rendered in DOM
  const transcriptNodes = Array.from(doc.querySelectorAll('ytd-transcript-segment-renderer'));
  const transcriptSegments = transcriptNodes
    .map((node, index) => {
      const ts =
        node.querySelector('.segment-timestamp, [class*="segment-timestamp"]')?.textContent?.trim() ||
        '00:00';
      const text =
        node
          .querySelector('.segment-text, yt-formatted-string.segment-text, [class*="segment-text"]')
          ?.textContent?.trim() || '';
      const startSeconds = parseTimestampToSeconds(ts);
      return {
        id: `dom-seg-${index + 1}`,
        startSeconds,
        endSeconds: startSeconds + 5,
        timestampLabel: ts,
        text,
      };
    })
    .filter((s) => s.text.length > 0);

  // Extract chapter markers from description timestamps (horizontal space only so lines never cross)
  const rawChapters: Array<{ title: string; startSeconds: number }> = [];
  const chapterRegex = /^(\d{1,2}:\d{2}(?::\d{2})?)[ \t]+(.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = chapterRegex.exec(description)) !== null) {
    const chTitle = match[2].trim().slice(0, 120);
    if (!/^(?:Tout afficher|View all|Transcription|Transcript)$/i.test(chTitle)) {
      rawChapters.push({
        startSeconds: parseTimestampToSeconds(match[1]),
        title: chTitle,
      });
    }
  }
  if (rawChapters.length === 0) {
    const markerNodes = Array.from(doc.querySelectorAll('ytd-macro-markers-list-item-renderer'));
    for (const marker of markerNodes) {
      const timeLabel = marker.querySelector('#time')?.textContent?.trim();
      const chTitle = marker.querySelector('h4, #details h4')?.textContent?.trim();
      if (timeLabel && chTitle) {
        rawChapters.push({
          startSeconds: parseTimestampToSeconds(timeLabel),
          title: chTitle.slice(0, 120),
        });
      }
    }
  }
  rawChapters.sort((a, b) => a.startSeconds - b.startSeconds);
  const chapters: Array<{ title: string; startSeconds: number }> = [];
  for (const ch of rawChapters) {
    const prev = chapters[chapters.length - 1];
    if (prev && Math.abs(ch.startSeconds - prev.startSeconds) <= 8) continue;
    chapters.push(ch);
  }

  return {
    sourcePlatform: 'youtube',
    videoId,
    title: title || `YouTube Video ${videoId}`,
    channelName,
    durationSeconds,
    pageUrl: loc.href,
    captionLanguage: doc.documentElement.lang || 'en',
    description,
    pinnedComment,
    labeledLinks,
    chapters,
    transcriptSegments,
    captionsAccessible: transcriptSegments.length > 0 || !isDrmProtected,
    isDrmProtected,
  };
}

interface CaptionTrackEntry {
  baseUrl?: string;
  languageCode?: string;
  kind?: string;
}

function extractJsonArrayAfterKey(source: string, key: string): string | null {
  const idx = source.indexOf(key);
  if (idx < 0) return null;
  const start = source.indexOf('[', idx + key.length);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }
  return null;
}

function parseTimedTextPayload(
  rawBody: string,
  idPrefix: string
): DetectedYouTubeContext['transcriptSegments'] {
  const segments: DetectedYouTubeContext['transcriptSegments'] = [];
  const trimmed = rawBody.trim();
  if (!trimmed) return segments;

  if (trimmed.startsWith('{')) {
    try {
      const json3 = JSON.parse(trimmed) as {
        events?: Array<{
          tStartMs?: number;
          dDurationMs?: number;
          segs?: Array<{ utf8?: string }>;
        }>;
      };
      for (const ev of json3.events || []) {
        if (!Array.isArray(ev.segs)) continue;
        const text = ev.segs
          .map((s) => s.utf8 || '')
          .join('')
          .replace(/\s+/g, ' ')
          .trim();
        if (!text) continue;
        const startSeconds = Math.floor((ev.tStartMs || 0) / 1000);
        const endSeconds = Math.max(
          startSeconds + 1,
          Math.floor(((ev.tStartMs || 0) + (ev.dDurationMs || 4000)) / 1000)
        );
        segments.push({
          id: `${idPrefix}-${segments.length + 1}`,
          startSeconds,
          endSeconds,
          timestampLabel: formatSecondsToTimestamp(startSeconds),
          text,
        });
      }
      return segments;
    } catch {
      return [];
    }
  }

  if (trimmed.includes('<text') && typeof DOMParser !== 'undefined') {
    const parsedXml = new DOMParser().parseFromString(trimmed, 'text/xml');
    for (const node of Array.from(parsedXml.querySelectorAll('text'))) {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const startSeconds = Math.floor(Number(node.getAttribute('start') || '0'));
      const dur = Number(node.getAttribute('dur') || '4');
      segments.push({
        id: `${idPrefix}-xml-${segments.length + 1}`,
        startSeconds,
        endSeconds: Math.max(startSeconds + 1, Math.floor(startSeconds + dur)),
        timestampLabel: formatSecondsToTimestamp(startSeconds),
        text,
      });
    }
  }
  return segments;
}

/**
 * YouTube's player signs live `/api/timedtext?...&pot=...` requests whenever CC loads.
 * Scanning PerformanceResourceTiming captures that valid same-origin signed URL directly.
 */
async function fetchFromPerformanceTimedText(
  videoId: string
): Promise<{ segments: DetectedYouTubeContext['transcriptSegments']; language?: string }> {
  if (typeof performance === 'undefined' || !performance.getEntriesByType) {
    return { segments: [] };
  }
  const resources = performance
    .getEntriesByType('resource')
    .filter(
      (entry) =>
        entry.name.includes('/api/timedtext') &&
        entry.name.includes(`v=${encodeURIComponent(videoId)}`)
    )
    .reverse();

  for (const entry of resources) {
    try {
      const signedUrl = new URL(entry.name);
      const lang = signedUrl.searchParams.get('lang') || undefined;
      const res = await fetch(signedUrl.toString(), { credentials: 'same-origin' });
      if (!res.ok) continue;
      const body = await res.text();
      const parsed = parseTimedTextPayload(body, 'yt-pot');
      if (parsed.length > 0) {
        return { segments: parsed, language: lang };
      }
    } catch {
      // Try next entry
    }
  }
  return { segments: [] };
}

async function fetchYouTubeTimedTextSegments(videoId: string): Promise<{
  segments: DetectedYouTubeContext['transcriptSegments'];
  language?: string;
}> {
  try {
    const perfFirst = await fetchFromPerformanceTimedText(videoId);
    if (perfFirst.segments.length > 0) {
      return perfFirst;
    }

    const pageRes = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
      credentials: 'same-origin',
    });
    if (!pageRes.ok) return { segments: [] };
    const html = await pageRes.text();
    const tracksRaw = extractJsonArrayAfterKey(html, '"captionTracks":');
    if (!tracksRaw) return { segments: [] };

    const tracks = JSON.parse(tracksRaw) as CaptionTrackEntry[];
    if (!Array.isArray(tracks) || tracks.length === 0) return { segments: [] };

    const preferred =
      tracks.find((t) => t.languageCode?.startsWith('en') && t.kind !== 'asr') ||
      tracks.find((t) => t.languageCode?.startsWith('en')) ||
      tracks.find((t) => t.kind !== 'asr') ||
      tracks[0];

    if (!preferred?.baseUrl) return { segments: [] };

    const timedUrl = new URL(preferred.baseUrl);
    timedUrl.searchParams.set('fmt', 'json3');
    const captionRes = await fetch(timedUrl.toString(), { credentials: 'same-origin' });
    if (captionRes.ok) {
      const parsedJson = parseTimedTextPayload(await captionRes.text(), 'yt-cap');
      if (parsedJson.length > 0) {
        return { segments: parsedJson, language: preferred.languageCode };
      }
    }

    const xmlRes = await fetch(preferred.baseUrl, { credentials: 'same-origin' });
    if (xmlRes.ok) {
      const parsedXml = parseTimedTextPayload(await xmlRes.text(), 'yt-cap');
      if (parsedXml.length > 0) {
        return { segments: parsedXml, language: preferred.languageCode };
      }
    }

    return { segments: [] };
  } catch {
    return { segments: [] };
  }
}

async function openAndReadDomTranscript(
  doc: Document,
  loc: Location
): Promise<DetectedYouTubeContext['transcriptSegments']> {
  // Expand collapsed description box first so chapters & Show Transcript mount into the DOM
  const expandBtn =
    (doc.querySelector('#description-inline-expander #expand') as HTMLElement | null) ||
    (doc.querySelector('tp-yt-paper-button#expand') as HTMLElement | null);
  if (expandBtn && expandBtn.getBoundingClientRect().height > 0) {
    expandBtn.click();
    await new Promise((r) => setTimeout(r, 450));
  }

  const transcriptBtn =
    (doc.querySelector('ytd-video-description-transcript-section-renderer #primary-button button') as HTMLElement | null) ||
    (doc.querySelector('ytd-video-description-transcript-section-renderer button') as HTMLElement | null) ||
    (doc.querySelector('ytd-structured-description-content-renderer button[aria-label*="transcript" i]') as HTMLElement | null) ||
    (doc.querySelector('button[aria-label*="transcription" i]') as HTMLElement | null) ||
    (doc.querySelector('button[aria-label*="transcript" i]') as HTMLElement | null);

  if (transcriptBtn) {
    transcriptBtn.click();
    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const refreshed = extractVisibleYouTubeContext(doc, loc);
      if (refreshed && refreshed.transcriptSegments.length > 0) {
        return refreshed.transcriptSegments;
      }
    }
  }
  return [];
}

async function triggerCaptionsButtonForTimedText(
  doc: Document,
  videoId: string
): Promise<{ segments: DetectedYouTubeContext['transcriptSegments']; language?: string }> {
  const ccBtn = doc.querySelector('button.ytp-subtitles-button') as HTMLElement | null;
  if (!ccBtn) return { segments: [] };

  const wasPressed = ccBtn.getAttribute('aria-pressed') === 'true';
  if (!wasPressed) {
    ccBtn.click();
  }

  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const result = await fetchFromPerformanceTimedText(videoId);
    if (result.segments.length > 0) {
      if (!wasPressed) ccBtn.click();
      return result;
    }
  }

  if (!wasPressed) {
    ccBtn.click();
  }
  return { segments: [] };
}

async function ensureExpandedDescriptionAndPinnedComment(
  doc: Document,
  loc: Location,
  base: DetectedYouTubeContext
): Promise<void> {
  if (typeof window === 'undefined') return;

  const expandBtn =
    (doc.querySelector('#description-inline-expander #expand') as HTMLElement | null) ||
    (doc.querySelector('tp-yt-paper-button#expand') as HTMLElement | null);
  if (expandBtn && expandBtn.getBoundingClientRect().height > 0) {
    expandBtn.click();
    await new Promise((r) => setTimeout(r, 350));
  }

  // If pinned/creator comment isn't rendered yet because #comments sits below the fold,
  // briefly nudge it into intersection view and immediately restore the user's scroll position.
  if (!doc.querySelector('ytd-comment-thread-renderer')) {
    const commentsHost = doc.querySelector('#comments') as HTMLElement | null;
    if (commentsHost && typeof commentsHost.scrollIntoView === 'function') {
      const prevY = window.scrollY;
      commentsHost.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'start' });
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 120));
        if (doc.querySelector('ytd-comment-thread-renderer')) break;
      }
      window.scrollTo(0, prevY);
    }
  }

  const refreshed = extractVisibleYouTubeContext(doc, loc);
  if (refreshed) {
    if (refreshed.description && refreshed.description.length > (base.description || '').length) {
      base.description = refreshed.description;
    }
    if (refreshed.chapters.length > base.chapters.length) {
      base.chapters = refreshed.chapters;
    }
    if (refreshed.pinnedComment) {
      base.pinnedComment = refreshed.pinnedComment;
    }
    if (refreshed.labeledLinks && refreshed.labeledLinks.length > (base.labeledLinks?.length || 0)) {
      base.labeledLinks = refreshed.labeledLinks;
    }
  }
}

export function captureCurrentVideoFrame(doc: Document): CapturedVideoFrame | null {
  return captureVideoFrameFromElement(doc, doc.querySelector('video') as HTMLVideoElement | null);
}

export async function extractVisibleYouTubeContextAsync(
  doc: Document,
  loc: Location
): Promise<DetectedYouTubeContext | null> {
  const base = extractVisibleYouTubeContext(doc, loc);
  if (!base || base.isDrmProtected) return base;

  await ensureExpandedDescriptionAndPinnedComment(doc, loc, base);
  if (base.transcriptSegments.length > 0) return base;

  // 1. Try open/signed performance timedtext or direct captionTracks
  const direct = await fetchYouTubeTimedTextSegments(base.videoId);
  if (direct.segments.length > 0) {
    base.transcriptSegments = direct.segments;
    base.captionsAccessible = true;
    if (direct.language) base.captionLanguage = direct.language;
    return base;
  }

  // 2. Expand description & trigger YouTube's Show Transcript panel in the DOM
  const domSegments = await openAndReadDomTranscript(doc, loc);
  if (domSegments.length > 0) {
    const refreshedMeta = extractVisibleYouTubeContext(doc, loc);
    if (refreshedMeta) {
      base.description = refreshedMeta.description;
      if (refreshedMeta.chapters.length > 0) base.chapters = refreshedMeta.chapters;
      if (refreshedMeta.pinnedComment) base.pinnedComment = refreshedMeta.pinnedComment;
      if (refreshedMeta.labeledLinks?.length) base.labeledLinks = refreshedMeta.labeledLinks;
    }
    base.transcriptSegments = domSegments;
    base.captionsAccessible = true;
    return base;
  }

  // 3. Final reliable fallback: toggle YouTube's native CC button briefly so YouTube's
  // own player issues its PO-token-signed `/api/timedtext?...&pot=...` request.
  const ccResult = await triggerCaptionsButtonForTimedText(doc, base.videoId);
  if (ccResult.segments.length > 0) {
    base.transcriptSegments = ccResult.segments;
    base.captionsAccessible = true;
    if (ccResult.language) base.captionLanguage = ccResult.language;
  }
  return base;
}

function injectTurnIntoSkillButton(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  if (!window.location.pathname.startsWith('/watch')) return;
  const existing = document.getElementById('skillloom-turn-into-skill-btn');
  if (existing) return;

  const actionsContainer =
    document.querySelector('#top-level-buttons-computed') ||
    document.querySelector('ytd-watch-metadata #actions-inner');
  if (!actionsContainer) return;

  const btn = document.createElement('button');
  btn.id = 'skillloom-turn-into-skill-btn';
  btn.type = 'button';
  btn.innerHTML =
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg><span>Turn into Skill</span>';
  btn.style.cssText = [
    'margin-left: 8px',
    'padding: 0 15px',
    'height: 36px',
    'border-radius: 18px',
    'border: 1px solid rgba(20, 184, 166, 0.55)',
    'background: linear-gradient(135deg, #14b8a6, #0d9488)',
    'color: #ffffff',
    'font-family: "YouTube Sans", "Roboto", system-ui, -apple-system, sans-serif',
    'font-size: 13px',
    'font-weight: 600',
    'cursor: pointer',
    'white-space: nowrap',
    'display: inline-flex',
    'align-items: center',
    'gap: 6px',
    'box-shadow: 0 2px 8px rgba(13, 148, 136, 0.25)',
    'transition: filter 140ms ease, transform 140ms ease',
  ].join(';');

  btn.addEventListener('mouseenter', () => {
    if (!btn.disabled) btn.style.filter = 'brightness(1.08)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.filter = '';
  });

  btn.addEventListener('click', () => {
    const labelSpan = btn.querySelector('span');
    if (labelSpan) labelSpan.textContent = 'Extracting skill...';
    btn.disabled = true;

    const chromeRuntime = (globalThis as {
      chrome?: { runtime?: { sendMessage: (msg: unknown, cb: (res: unknown) => void) => void } };
    }).chrome?.runtime;

    extractVisibleYouTubeContextAsync(document, window.location)
      .then((context) => {
        if (!context || !chromeRuntime) {
          if (labelSpan) labelSpan.textContent = 'Open SkillLoom Popup';
          return;
        }
        chromeRuntime.sendMessage({ type: 'OPEN_SKILL_STUDIO', payload: context }, (response) => {
          const res = response as { ok?: boolean } | undefined;
          if (labelSpan) {
            labelSpan.textContent = res?.ok ? 'Opened Studio ✓' : 'Open SkillLoom Popup';
          }
        });
      })
      .catch(() => {
        if (labelSpan) labelSpan.textContent = 'Try SkillLoom Popup';
      })
      .finally(() => {
        setTimeout(() => {
          btn.disabled = false;
          if (labelSpan) labelSpan.textContent = 'Turn into Skill';
        }, 3200);
      });
  });

  actionsContainer.appendChild(btn);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('yt-navigate-finish', () => {
    injectTurnIntoSkillButton();
  });
  injectTurnIntoSkillButton();

  const chromeRuntime = (globalThis as {
    chrome?: {
      runtime?: {
        onMessage: {
          addListener: (
            fn: (
              msg: { type: string; maxFrames?: number; targetSeconds?: number; resumePlay?: boolean },
              _sender: unknown,
              sendResponse: (r: unknown) => void
            ) => boolean | void
          ) => void;
        };
      };
    };
  }).chrome?.runtime;

  if (chromeRuntime?.onMessage) {
    chromeRuntime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'GET_ACTIVE_YOUTUBE_VIDEO' || msg.type === 'GET_ACTIVE_VIDEO') {
        extractVisibleYouTubeContextAsync(document, window.location)
          .then((data) => sendResponse({ ok: true, data }))
          .catch(() => sendResponse({ ok: true, data: extractVisibleYouTubeContext(document, window.location) }));
        return true;
      }
      if (msg.type === 'AUTO_CAPTURE_STORYBOARD') {
        const vid = document.querySelector('video') as HTMLVideoElement | null;
        autoCaptureVideoStoryboard(document, vid, msg.maxFrames || 5)
          .then((result) => sendResponse({ ok: result.frames.length > 0, ...result }))
          .catch(() => sendResponse({ ok: false, frames: [], taintedOrBlocked: true, durationSeconds: 0 }));
        return true;
      }
      if (msg.type === 'SEEK_VIDEO_TIMESTAMP') {
        const vid = document.querySelector('video') as HTMLVideoElement | null;
        if (!vid || typeof msg.targetSeconds !== 'number') {
          sendResponse({ ok: false });
          return false;
        }
        if (!vid.paused && typeof vid.pause === 'function') {
          vid.pause();
        }
        seekVideoElement(vid, msg.targetSeconds)
          .then((ok) => {
            const sec = Math.max(0, Math.floor(vid.currentTime || 0));
            sendResponse({ ok, timestampSeconds: sec, timestampLabel: formatSecondsToTimestamp(sec) });
          })
          .catch(() => sendResponse({ ok: false }));
        return true;
      }
      if (msg.type === 'RESTORE_VIDEO_STATE') {
        const vid = document.querySelector('video') as HTMLVideoElement | null;
        if (vid) {
          if (typeof msg.targetSeconds === 'number' && Number.isFinite(msg.targetSeconds)) {
            try {
              vid.currentTime = msg.targetSeconds;
            } catch {
              // ignore
            }
          }
          if (msg.resumePlay && typeof vid.play === 'function') {
            try {
              const p = vid.play();
              if (p && typeof p.catch === 'function') p.catch(() => {});
            } catch {
              // ignore
            }
          }
        }
        sendResponse({ ok: Boolean(vid) });
        return false;
      }
      if (msg.type === 'CAPTURE_VIDEO_FRAME') {
        const frame = captureCurrentVideoFrame(document);
        sendResponse({ ok: Boolean(frame), frame });
        return false;
      }
      return false;
    });
  }
}
