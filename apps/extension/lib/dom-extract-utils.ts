/**
 * Shared pure-browser DOM extraction helpers used by YouTube, Instagram Reels, and X / Twitter
 * content scripts (link unwrapping, timestamp formatting, active video selection,
 * and canvas keyframe capture with CORS-taint safety).
 */

export type SourcePlatform = 'youtube' | 'instagram' | 'twitter';

export interface LabeledReferenceLink {
  label: string;
  url: string;
  source: 'description' | 'pinned_comment';
}

export interface CapturedVideoFrame {
  id: string;
  timestampSeconds: number;
  timestampLabel: string;
  dataUrl: string;
  note?: string;
  source: 'video_canvas' | 'visible_tab';
  contentScore?: number;
  contentKind?: 'code-or-ui' | 'text-slide' | 'visual-scene';
}

export interface CapturedAudioClip {
  dataUrl: string;
  durationSeconds: number;
  mimeType?: string;
}

export interface DetectedVideoContext {
  sourcePlatform?: SourcePlatform;
  videoId: string;
  title: string;
  channelName: string;
  durationSeconds: number;
  pageUrl: string;
  captionLanguage?: string;
  description?: string;
  pinnedComment?: {
    author: string;
    text: string;
    isCreator: boolean;
  };
  labeledLinks?: LabeledReferenceLink[];
  capturedFrames?: CapturedVideoFrame[];
  aiVisionSheets?: string[];
  capturedAudio?: CapturedAudioClip;
  chapters: Array<{ title: string; startSeconds: number }>;
  transcriptSegments: Array<{
    id: string;
    startSeconds: number;
    endSeconds: number;
    timestampLabel: string;
    text: string;
  }>;
  captionsAccessible: boolean;
  isDrmProtected: boolean;
}

/**
 * Formats integer seconds into `MM:SS` or `H:MM:SS`.
 */
export function formatSecondsToTimestamp(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * Unwraps platform outbound redirectors (`/redirect?q=` on YouTube, `l.instagram.com/?u=`
 * on Instagram) and filters internal platform chrome links while keeping external references.
 */
export function unwrapRedirectUrl(rawHref: string, platform: SourcePlatform): string | null {
  try {
    const baseOrigin =
      platform === 'instagram'
        ? 'https://www.instagram.com'
        : platform === 'twitter'
          ? 'https://x.com'
          : 'https://www.youtube.com';
    const parsed = new URL(rawHref, baseOrigin);

    if (platform === 'youtube' && parsed.pathname === '/redirect') {
      const target = parsed.searchParams.get('q');
      if (target && /^https?:\/\//i.test(target)) {
        return target;
      }
      return null;
    }

    if (
      platform === 'instagram' &&
      (/^(?:l|lm)\.instagram\.com$/i.test(parsed.hostname) || parsed.pathname === '/redirect')
    ) {
      const target = parsed.searchParams.get('u') || parsed.searchParams.get('q');
      if (target && /^https?:\/\//i.test(target)) {
        return stripSocialTrackingParams(target);
      }
      return null;
    }

    if (!/^https?:$/i.test(parsed.protocol)) return null;

    if (platform === 'youtube') {
      if (
        /^(?:www\.)?(?:youtube\.com|youtu\.be|accounts\.google\.com|policies\.google\.com)$/i.test(
          parsed.hostname
        )
      ) {
        return null;
      }
      if (parsed.hostname === 'support.google.com' && parsed.pathname.startsWith('/youtube')) {
        return null;
      }
      return parsed.toString();
    }

    if (platform === 'twitter') {
      if (
        /^(?:[a-z0-9-]+\.)?(?:x\.com|twitter\.com|twimg\.com)$/i.test(parsed.hostname)
      ) {
        return null;
      }
      return stripSocialTrackingParams(parsed.toString());
    }

    if (
      /^(?:[a-z0-9-]+\.)?(?:instagram\.com|facebook\.com|fb\.com|threads\.net|meta\.com)$/i.test(
        parsed.hostname
      )
    ) {
      return null;
    }
    return stripSocialTrackingParams(parsed.toString());
  } catch {
    return null;
  }
}

function stripSocialTrackingParams(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    for (const key of ['fbclid', 'igshid', 'ig_mid', 'utm_source', 'utm_medium', 's', 't']) {
      if ((key === 's' || key === 't') && !/^[0-9]{1,3}$|^[A-Za-z0-9_-]{16,}$/.test(url.searchParams.get(key) || '')) {
        continue;
      }
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Extracts labeled external reference links from an element container and/or fallback raw text.
 */
export function extractLabeledLinksFromContainer(
  container: Element | null,
  rawText: string,
  source: LabeledReferenceLink['source'],
  platform: SourcePlatform
): LabeledReferenceLink[] {
  const results: LabeledReferenceLink[] = [];
  const seenUrls = new Set<string>();
  const lines = rawText.split(/\r?\n/);

  if (container) {
    const anchors = Array.from(container.querySelectorAll('a[href]'));
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || '';
      const resolved = unwrapRedirectUrl(href, platform);
      if (!resolved || seenUrls.has(resolved)) continue;
      seenUrls.add(resolved);

      const anchorText = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
      const anchorIsDescriptive =
        anchorText.length >= 3 &&
        anchorText.length <= 60 &&
        !/^https?:\/\//i.test(anchorText) &&
        !/^(?:link|here|click here|visit|website)$/i.test(anchorText);
      const matchingLine = lines.find((line) =>
        anchorText.length >= 6 ? line.includes(anchorText) : line.includes(resolved)
      );
      let label = anchorText;
      if (!anchorIsDescriptive && matchingLine) {
        const cleanedLine = matchingLine
          .replace(anchorText, '')
          .replace(/https?:\/\/\S+/gi, '')
          .replace(/[:\-–|>\s]+$/g, '')
          .replace(/^[\s•\-*:—–|>]+/g, '')
          .trim();
        if (cleanedLine.length >= 2 && cleanedLine.length <= 90) {
          label = cleanedLine;
        }
      }
      if (!label || /^https?:\/\//i.test(label)) {
        try {
          label = new URL(resolved).hostname.replace(/^www\./, '');
        } catch {
          label = 'External Resource';
        }
      }
      results.push({ label, url: resolved, source });
      if (results.length >= 16) return results;
    }
  }

  for (const line of lines) {
    const urls = line.match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
    for (const rawUrl of urls) {
      const resolved =
        unwrapRedirectUrl(rawUrl, platform) || (/^https?:\/\//i.test(rawUrl) ? rawUrl : null);
      if (!resolved || seenUrls.has(resolved)) continue;
      if (
        platform === 'instagram' &&
        /^https?:\/\/(?:[a-z0-9-]+\.)?instagram\.com/i.test(resolved)
      ) {
        continue;
      }
      seenUrls.add(resolved);
      const labelCandidate = line
        .replace(rawUrl, '')
        .replace(/[:\-–|>\s]+$/g, '')
        .replace(/^[\s•\-*]+/g, '')
        .trim();
      results.push({
        label:
          labelCandidate.length >= 2 && labelCandidate.length <= 90
            ? labelCandidate
            : resolved.replace(/^https?:\/\/(?:www\.)?/i, '').split('/')[0] || 'External Resource',
        url: resolved,
        source,
      });
      if (results.length >= 16) return results;
    }
  }
  return results;
}

/**
 * Picks the most visible / actively playing `<video>` element in the viewport.
 * Essential on infinite-scroll feeds like Instagram Reels where off-screen videos stay mounted.
 */
export function findBestVisibleVideo(doc: Document): HTMLVideoElement | null {
  const videos = Array.from(doc.querySelectorAll('video')) as HTMLVideoElement[];
  if (videos.length === 0) return null;
  if (videos.length === 1) return videos[0];

  const win = doc.defaultView;
  const vw = win?.innerWidth || 1280;
  const vh = win?.innerHeight || 720;

  let bestVideo: HTMLVideoElement = videos[0];
  let bestScore = -1;

  for (const video of videos) {
    let score = 0;
    if (!video.paused && !video.ended) score += 1000;
    if (video.readyState >= 2) score += 200;
    if (video.videoWidth > 0) score += 100;

    if (typeof video.getBoundingClientRect === 'function') {
      const rect = video.getBoundingClientRect();
      const visW = Math.max(0, Math.min(rect.right, vw) - Math.max(rect.left, 0));
      const visH = Math.max(0, Math.min(rect.bottom, vh) - Math.max(rect.top, 0));
      const area = visW * visH;
      if (area > 0) {
        score += area / 100;
      } else if (rect.width === 0 && rect.height === 0) {
        // Test/JSDOM environments report zero rects; preserve DOM order slightly
        score += 1;
      }
    }

    if (score > bestScore) {
      bestScore = score;
      bestVideo = video;
    }
  }

  return bestVideo;
}

/**
 * Lightweight zero-dependency visual content-density estimator for captured keyframes.
 * Measures horizontal/vertical high-contrast edge transitions across sampled scanlines:
 * code editors, terminals, UI settings dialogs, and text slides produce sharp edge clusters
 * compared to talking-head frames or flat transitions.
 */
export function scoreCanvasFrameContent(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): { contentScore: number; contentKind: 'code-or-ui' | 'text-slide' | 'visual-scene' } | null {
  if (typeof ctx.getImageData !== 'function' || width < 16 || height < 16) {
    return null;
  }
  try {
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const stepX = Math.max(2, Math.floor(width / 120));
    const stepY = Math.max(2, Math.floor(height / 72));

    let samples = 0;
    let sharpEdges = 0;
    let darkPixels = 0;
    let brightPixels = 0;
    let activeTextRows = 0;
    let totalRows = 0;

    for (let y = stepY; y < height - stepY; y += stepY) {
      totalRows++;
      let rowEdges = 0;
      let rowSamples = 0;
      for (let x = stepX; x < width - stepX; x += stepX) {
        const idx = (y * width + x) * 4;
        const idxLeft = (y * width + (x - stepX)) * 4;
        const idxUp = ((y - stepY) * width + x) * 4;

        const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        const lumLeft = 0.299 * data[idxLeft] + 0.587 * data[idxLeft + 1] + 0.114 * data[idxLeft + 2];
        const lumUp = 0.299 * data[idxUp] + 0.587 * data[idxUp + 1] + 0.114 * data[idxUp + 2];

        const grad = Math.abs(lum - lumLeft) + Math.abs(lum - lumUp);
        if (grad >= 48) {
          sharpEdges++;
          rowEdges++;
        }
        if (lum < 55) darkPixels++;
        if (lum > 205) brightPixels++;
        samples++;
        rowSamples++;
      }
      if (rowSamples > 0 && rowEdges / rowSamples >= 0.08) {
        activeTextRows++;
      }
    }

    if (samples === 0 || totalRows === 0) return null;
    const edgeRatio = sharpEdges / samples;
    const textRowRatio = activeTextRows / totalRows;
    const darkRatio = darkPixels / samples;
    const brightRatio = brightPixels / samples;
    const bimodalUiBonus = (darkRatio > 0.35 || brightRatio > 0.35) && edgeRatio >= 0.05 ? 18 : 0;

    const rawScore = Math.round(
      Math.min(100, edgeRatio * 240 + textRowRatio * 42 + bimodalUiBonus)
    );
    const contentKind: 'code-or-ui' | 'text-slide' | 'visual-scene' =
      rawScore >= 52 && (darkRatio > 0.35 || textRowRatio >= 0.35)
        ? 'code-or-ui'
        : rawScore >= 34
          ? 'text-slide'
          : 'visual-scene';

    return { contentScore: rawScore, contentKind };
  } catch {
    return null;
  }
}

/**
 * Captures a scaled JPEG keyframe directly from a `<video>` element via canvas.
 * Returns `null` if the video is unready or cross-origin tainted (`SecurityError`),
 * allowing callers to fall back to `chrome.tabs.captureVisibleTab`.
 */
export function captureVideoFrameFromElement(
  doc: Document,
  videoEl: HTMLVideoElement | null,
  maxWidth = 720,
  quality = 0.78
): CapturedVideoFrame | null {
  if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) {
    return null;
  }

  try {
    const targetWidth = Math.min(maxWidth, videoEl.videoWidth);
    const scale = targetWidth / videoEl.videoWidth;
    const targetHeight = Math.max(1, Math.round(videoEl.videoHeight * scale));
    const canvas = doc.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(videoEl, 0, 0, targetWidth, targetHeight);
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return null;

    const visualMetrics = scoreCanvasFrameContent(ctx, targetWidth, targetHeight);
    const sec = Math.max(0, Math.floor(videoEl.currentTime || 0));
    return {
      id: `frame-${sec}s-${Date.now()}`,
      timestampSeconds: sec,
      timestampLabel: formatSecondsToTimestamp(sec),
      dataUrl,
      source: 'video_canvas',
      ...(visualMetrics || {}),
    };
  } catch {
    return null;
  }
}

/**
 * Computes evenly distributed keyframe timestamps across a video/Reel duration.
 */
export function computeStoryboardTimestamps(
  durationSeconds: number,
  maxFrames = 5
): number[] {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0.5 || maxFrames <= 0) {
    return [];
  }
  const safeCount = Math.max(1, Math.min(12, maxFrames));
  let fractions: number[];
  if (durationSeconds < 5) {
    fractions = [0.12, 0.38, 0.64, 0.88].slice(0, safeCount);
  } else if (safeCount <= 6) {
    fractions = [0.08, 0.27, 0.46, 0.65, 0.84, 0.93].slice(0, safeCount);
  } else {
    fractions = Array.from(
      { length: safeCount },
      (_, i) => 0.05 + (i * 0.89) / Math.max(1, safeCount - 1)
    );
  }
  const maxSafe = Math.max(0.15, durationSeconds - 0.3);
  const minSafe = Math.min(0.35, maxSafe * 0.5);

  const out: number[] = [];
  const seen = new Set<string>();
  for (const frac of fractions) {
    const raw = Math.max(minSafe, Math.min(maxSafe, durationSeconds * frac));
    const rounded = Math.round(raw * 10) / 10;
    const key = String(Math.floor(rounded));
    if (seen.has(key) && durationSeconds >= safeCount) continue;
    seen.add(key);
    if (!out.some((t) => Math.abs(t - rounded) < 0.25)) {
      out.push(rounded);
    }
  }
  return out;
}

/**
 * Seeks an HTMLVideoElement cleanly to `targetSeconds`, awaiting the browser `seeked` event
 * and a brief frame-decode settle tick (safely handling minimal DOM mocks without addEventListener).
 */
export function seekVideoElement(
  videoEl: HTMLVideoElement,
  targetSeconds: number,
  timeoutMs = 850
): Promise<boolean> {
  if (!Number.isFinite(targetSeconds)) return Promise.resolve(false);
  if (typeof videoEl.addEventListener !== 'function') {
    videoEl.currentTime = targetSeconds;
    return Promise.resolve(true);
  }
  const alreadyAtTarget = Math.abs((videoEl.currentTime || 0) - targetSeconds) < 0.08;
  if (alreadyAtTarget) {
    return new Promise((resolve) => setTimeout(() => resolve(true), 45));
  }

  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      videoEl.removeEventListener('seeked', onSeeked);
      setTimeout(() => resolve(ok), 55);
    };
    const onSeeked = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    videoEl.addEventListener('seeked', onSeeked);
    try {
      videoEl.currentTime = targetSeconds;
    } catch {
      finish(false);
    }
  });
}

/**
 * Automatically seeks across evenly distributed timestamps of a video/Reel and extracts
 * up to `maxFrames` canvas keyframes, restoring playback position & play/pause state afterward.
 * Immediately aborts and flags `taintedOrBlocked` on frame #1 if CORS blocks pixel reads.
 */
export async function autoCaptureVideoStoryboard(
  doc: Document,
  videoEl: HTMLVideoElement | null,
  maxFrames = 5
): Promise<{
  frames: CapturedVideoFrame[];
  taintedOrBlocked: boolean;
  durationSeconds: number;
  originalTime: number;
  wasPaused: boolean;
}> {
  if (!videoEl || videoEl.readyState < 1 || videoEl.videoWidth <= 0) {
    return {
      frames: [],
      taintedOrBlocked: true,
      durationSeconds: 0,
      originalTime: 0,
      wasPaused: true,
    };
  }

  const originalTime = Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0;
  const wasPaused = Boolean(videoEl.paused);
  const duration =
    Number.isFinite(videoEl.duration) && videoEl.duration > 0 ? videoEl.duration : 0;
  const targets = computeStoryboardTimestamps(duration, maxFrames);

  if (targets.length === 0) {
    const single = captureVideoFrameFromElement(doc, videoEl);
    return {
      frames: single ? [single] : [],
      taintedOrBlocked: !single,
      durationSeconds: Math.round(duration),
      originalTime,
      wasPaused,
    };
  }

  const frames: CapturedVideoFrame[] = [];
  let taintedOrBlocked = false;

  try {
    if (!wasPaused && typeof videoEl.pause === 'function') {
      videoEl.pause();
    }
    const frameWidth = targets.length > 6 ? 480 : 680;
    const frameQuality = targets.length > 6 ? 0.72 : 0.78;
    for (const targetSec of targets) {
      await seekVideoElement(videoEl, targetSec);
      const frame = captureVideoFrameFromElement(doc, videoEl, frameWidth, frameQuality);
      if (!frame) {
        if (frames.length === 0) {
          taintedOrBlocked = true;
          break;
        }
        continue;
      }
      const isDuplicate = frames.some(
        (prev) =>
          prev.timestampLabel === frame.timestampLabel ||
          (prev.dataUrl.length === frame.dataUrl.length &&
            prev.dataUrl.slice(0, 128) === frame.dataUrl.slice(0, 128))
      );
      if (!isDuplicate) {
        frames.push({
          ...frame,
          id: `auto-${frames.length + 1}-${frame.timestampSeconds}s-${Date.now()}`,
        });
      }
    }
  } finally {
    try {
      videoEl.currentTime = originalTime;
    } catch {
      // Ignore read-only currentTime in constrained mocks
    }
    if (!wasPaused && typeof videoEl.play === 'function') {
      try {
        const playRes = videoEl.play();
        if (playRes && typeof playRes.catch === 'function') {
          playRes.catch(() => {});
        }
      } catch {
        // Ignore autoplay restrictions
      }
    }
  }

  return {
    frames,
    taintedOrBlocked,
    durationSeconds: Math.round(duration),
    originalTime,
    wasPaused,
  };
}

/**
 * Evenly samples up to `targetCount` frames across a longer captured sequence (keeping start & end).
 */
export function selectSpreadFrames<T>(items: T[], targetCount = 6): T[] {
  if (items.length <= targetCount) return [...items];
  const chosen: T[] = [];
  for (let i = 0; i < targetCount; i++) {
    const idx = Math.min(
      items.length - 1,
      Math.round((i * (items.length - 1)) / Math.max(1, targetCount - 1))
    );
    if (!chosen.includes(items[idx])) chosen.push(items[idx]);
  }
  return chosen;
}

/**
 * Stitches up to 12 captured frames into compact `3x2` timestamp-labeled JPEG contact sheets
 * so Vision LLMs read 2x as many on-screen subtitles & UI frames in <=2 lightweight images.
 */
export async function buildStoryboardContactSheets(
  doc: Document,
  frames: Array<{ dataUrl: string; timestampLabel: string }>,
  cols = 3,
  rows = 2
): Promise<string[]> {
  if (frames.length === 0 || typeof Image === 'undefined') return [];
  const loadImage = (src: string): Promise<HTMLImageElement | null> =>
    new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });

  const loaded = await Promise.all(
    frames.slice(0, 12).map(async (f) => ({ frame: f, img: await loadImage(f.dataUrl) }))
  );
  const valid = loaded.filter(
    (x): x is { frame: { dataUrl: string; timestampLabel: string }; img: HTMLImageElement } =>
      Boolean(x.img && (x.img.naturalWidth || x.img.width) > 0)
  );
  if (valid.length === 0) return [];

  const perSheet = Math.max(1, cols * rows);
  const sheets: string[] = [];

  for (let offset = 0; offset < valid.length; offset += perSheet) {
    const slice = valid.slice(offset, offset + perSheet);
    const sample = slice[0].img;
    const natW = sample.naturalWidth || sample.width || 360;
    const natH = sample.naturalHeight || sample.height || 640;
    const isPortrait = natH > natW;
    const tileW = isPortrait ? 300 : 360;
    const tileH = Math.min(isPortrait ? 460 : 240, Math.max(120, Math.round((natH / natW) * tileW)));
    const headerH = 22;
    const pad = 6;
    const gridCols = Math.min(cols, slice.length);
    const gridRows = Math.ceil(slice.length / gridCols);

    const canvas = doc.createElement('canvas');
    canvas.width = gridCols * tileW + (gridCols + 1) * pad;
    canvas.height = gridRows * (tileH + headerH) + (gridRows + 1) * pad;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    ctx.fillStyle = '#090d16';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    slice.forEach((item, idx) => {
      const col = idx % gridCols;
      const row = Math.floor(idx / gridCols);
      const x = pad + col * (tileW + pad);
      const y = pad + row * (tileH + headerH + pad);

      ctx.fillStyle = '#111827';
      ctx.fillRect(x, y, tileW, headerH);
      ctx.fillStyle = '#5eead4';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(`#${offset + idx + 1} [${item.frame.timestampLabel}]`, x + 6, y + 15);
      ctx.drawImage(item.img, x, y + headerH, tileW, tileH);
    });

    try {
      const url = canvas.toDataURL('image/jpeg', 0.74);
      const b64 = url.split(',')[1];
      if (b64) sheets.push(b64);
    } catch {
      // Ignore canvas serialization error
    }
  }

  return sheets;
}

const IG_RESERVED_PATH_SEGMENTS = new Set([
  'reel',
  'reels',
  'p',
  'explore',
  'accounts',
  'direct',
  'stories',
  'audio',
  'tags',
  'legal',
  'about',
  'developer',
  'privacy',
]);

export interface ParsedInstagramUrl {
  kind: 'reel' | 'post' | 'reels_feed' | 'other';
  shortcode: string | null;
  canonicalUrl: string;
  username?: string;
}

/**
 * Parses Instagram Reel, Post, and Reels feed URLs including profile-scoped `/<user>/reel/<id>/`.
 */
export function parseInstagramReelUrl(rawUrl: string): ParsedInstagramUrl | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/(?:^|\.)instagram\.com$/i.test(url.hostname)) return null;

  const firstSeg = url.pathname.split('/').filter(Boolean)[0];
  const pathUsername =
    firstSeg &&
    !IG_RESERVED_PATH_SEGMENTS.has(firstSeg.toLowerCase()) &&
    /^[a-zA-Z0-9._]{2,30}$/.test(firstSeg)
      ? `@${firstSeg}`
      : undefined;

  const reelMatch = url.pathname.match(/(?:^|\/)(reel|reels)\/([a-zA-Z0-9_-]{4,64})(?:\/|$)/i);
  if (reelMatch?.[2]) {
    const shortcode = reelMatch[2];
    return {
      kind: 'reel',
      shortcode,
      canonicalUrl: `https://www.instagram.com/reel/${shortcode}/`,
      username: pathUsername,
    };
  }

  const postMatch = url.pathname.match(/(?:^|\/)p\/([a-zA-Z0-9_-]{4,64})(?:\/|$)/i);
  if (postMatch?.[1]) {
    const shortcode = postMatch[1];
    return {
      kind: 'post',
      shortcode,
      canonicalUrl: `https://www.instagram.com/reel/${shortcode}/`,
      username: pathUsername,
    };
  }

  if (/(?:^|\/)reels\/?$/i.test(url.pathname)) {
    return {
      kind: 'reels_feed',
      shortcode: null,
      canonicalUrl: url.toString(),
      username: pathUsername,
    };
  }

  return {
    kind: 'other',
    shortcode: null,
    canonicalUrl: url.toString(),
    username: pathUsername,
  };
}

/**
 * Builds a minimal Reel context from tab URL + title when browser DOM injection is blocked,
 * enabling screen-snap frame capture and Studio manual/clipboard workflow completion.
 */
export function buildFallbackInstagramVideoFromTab(
  tabUrl: string,
  tabTitle?: string
): DetectedVideoContext | null {
  const parsed = parseInstagramReelUrl(tabUrl);
  if (!parsed) return null;

  const shortcode = parsed.shortcode || 'feed-active';
  const cleanTabTitle = (tabTitle || '')
    .replace(/\s*[•|]\s*Instagram.*$/i, '')
    .replace(/^Instagram\s*$/i, '')
    .trim();
  const title =
    cleanTabTitle.length >= 6
      ? cleanTabTitle
      : `Instagram Reel (${shortcode === 'feed-active' ? 'Active Tab' : shortcode})`;

  return {
    sourcePlatform: 'instagram',
    videoId: `ig-${shortcode}`,
    title,
    channelName: parsed.username || '@instagram-creator',
    durationSeconds: 0,
    pageUrl: parsed.canonicalUrl,
    captionLanguage: 'en',
    description: '',
    labeledLinks: [],
    chapters: [],
    transcriptSegments: [],
    captionsAccessible: false,
    isDrmProtected: false,
  };
}

export interface ParsedTwitterUrlInfo {
  kind: 'status' | 'article' | 'feed' | 'other';
  statusId: string | null;
  canonicalUrl: string;
  username: string | null;
}

const RESERVED_TWITTER_ROUTES = new Set([
  'home',
  'explore',
  'notifications',
  'messages',
  'bookmarks',
  'lists',
  'i',
  'search',
  'settings',
  'compose',
]);

/**
 * Parses X / Twitter URLs (`x.com/<user>/status/<id>`, `twitter.com/...`, home feed, profile).
 */
export function parseTwitterPostUrl(rawUrl: string): ParsedTwitterUrlInfo | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (!/^(?:www\.|mobile\.)?(?:x\.com|twitter\.com)$/i.test(url.hostname)) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const first = segments[0] || '';
  const username =
    first && !RESERVED_TWITTER_ROUTES.has(first.toLowerCase()) && /^[a-zA-Z0-9_]{1,30}$/.test(first)
      ? `@${first}`
      : null;

  const statusMatch = url.pathname.match(/\/([a-zA-Z0-9_]{1,30})\/status(?:es)?\/(\d{5,30})/i);
  if (statusMatch?.[2]) {
    const handle = `@${statusMatch[1]}`;
    const statusId = statusMatch[2];
    return {
      kind: 'status',
      statusId,
      canonicalUrl: `https://x.com/${statusMatch[1]}/status/${statusId}`,
      username: handle,
    };
  }

  if (segments[0] === 'i' && segments[1] === 'article' && segments[2]) {
    return {
      kind: 'article',
      statusId: segments[2],
      canonicalUrl: `https://x.com/i/article/${segments[2]}`,
      username: null,
    };
  }

  if (segments[0] === 'home' || segments.length === 0) {
    return {
      kind: 'feed',
      statusId: null,
      canonicalUrl: url.toString(),
      username: null,
    };
  }

  return {
    kind: 'other',
    statusId: null,
    canonicalUrl: url.toString(),
    username,
  };
}

/**
 * Builds a minimal X / Twitter context from tab URL + title if DOM extraction is restricted.
 */
export function buildFallbackTwitterPostFromTab(
  tabUrl: string,
  tabTitle?: string
): DetectedVideoContext | null {
  const parsed = parseTwitterPostUrl(tabUrl);
  if (!parsed) return null;

  const idSuffix = parsed.statusId || 'feed-active';
  const cleanTabTitle = (tabTitle || '')
    .replace(/\s*\/\s*X\s*$/i, '')
    .replace(/\s+on X:\s*/i, ': ')
    .replace(/^X\s*$/i, '')
    .trim();
  const title =
    cleanTabTitle.length >= 6
      ? cleanTabTitle.slice(0, 140)
      : `X Post (${parsed.username || idSuffix})`;

  return {
    sourcePlatform: 'twitter',
    videoId: `x-${idSuffix}`,
    title,
    channelName: parsed.username || '@x-creator',
    durationSeconds: 0,
    pageUrl: parsed.canonicalUrl,
    captionLanguage: 'en',
    description: cleanTabTitle,
    labeledLinks: [],
    chapters: [],
    transcriptSegments: [],
    captionsAccessible: false,
    isDrmProtected: false,
  };
}
