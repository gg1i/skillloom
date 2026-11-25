/**
 * SkillLoom Chrome/Edge Content Script for https://www.instagram.com/
 * Extracts active Instagram Reel metadata (Reel URL/ID, @creator, expanded caption,
 * creator/top substantive comment, unwrapped external links, optional <track> cues,
 * and keyframe snapshots) using strictly browser-visible DOM state.
 */

import {
  autoCaptureVideoStoryboard,
  captureVideoFrameFromElement,
  type CapturedVideoFrame,
  type DetectedVideoContext,
  extractLabeledLinksFromContainer,
  findBestVisibleVideo,
  formatSecondsToTimestamp,
  type LabeledReferenceLink,
  parseInstagramReelUrl,
  seekVideoElement,
} from '../lib/dom-extract-utils';

const RESERVED_IG_ROUTES = new Set([
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

const UI_CHROME_LINE_RE =
  /^(?:like|likes|comment|comments|share|save|saved|follow|following|requested|verified|original audio|more|see more|less|reply|see translation|view all \d+ comments?|view replies|\d+[smhdw]|[\d,.]+[km]?\s*(?:likes?|views?|comments?))$/i;

function extractUsernameFromHref(href: string): string | null {
  try {
    const parsed = new URL(href, 'https://www.instagram.com');
    if (!/^(?:www\.)?instagram\.com$/i.test(parsed.hostname)) return null;
    const segments = parsed.pathname.split('/').filter(Boolean);
    const isProfilePath =
      segments.length === 1 ||
      (segments.length === 2 && /^(?:reels?|p|tagged)$/i.test(segments[1]));
    if (!isProfilePath) return null;
    const candidate = segments[0];
    if (RESERVED_IG_ROUTES.has(candidate.toLowerCase())) return null;
    if (!/^[a-zA-Z0-9._]{2,30}$/.test(candidate)) return null;
    return `@${candidate}`;
  } catch {
    return null;
  }
}

/**
 * Resolves the tightest ancestor container around an active `<video>` element without
 * spilling into sibling Reels inside `/reels/` infinite scroll feeds.
 */
export function findActiveReelContainer(
  doc: Document,
  activeVideo: HTMLVideoElement | null
): Element {
  if (!activeVideo) {
    return doc.querySelector('main article') || doc.querySelector('main') || doc.body;
  }

  let best: Element = activeVideo.parentElement || doc.body;
  let current: Element | null = activeVideo.parentElement;

  for (let depth = 0; depth < 50 && current && current !== doc.body; depth++) {
    const videoCount = current.querySelectorAll('video').length;
    if (videoCount > 1) break;
    best = current;
    if (current.tagName === 'ARTICLE' || current.getAttribute?.('role') === 'dialog') break;
    current = current.parentElement;
  }

  if (
    best.tagName !== 'ARTICLE' &&
    best.getAttribute?.('role') !== 'dialog' &&
    (best.textContent || '').trim().length < 20
  ) {
    const dialogOrArticle =
      (activeVideo.closest?.('article, [role="dialog"]') as Element | null) ||
      doc.querySelector('[role="dialog"] article, [role="dialog"], main article, main, article') ||
      ((doc.body?.querySelectorAll?.('video').length || 0) <= 1 ? doc.body : null);
    if (dialogOrArticle && dialogOrArticle.querySelectorAll('video').length <= 1) {
      return dialogOrArticle;
    }
  }

  return best;
}

/**
 * Extracts active Reel shortcode & canonical Reel URL from location or visible container links.
 */
export function extractInstagramReelIdentity(
  doc: Document,
  loc: Location,
  container: Element | null,
  activeVideo: HTMLVideoElement | null
): { videoId: string; canonicalUrl: string } | null {
  const parsed = parseInstagramReelUrl(loc.href);
  if (!parsed) return null;

  const findContainerReelShortcode = (): string | null => {
    const scope =
      (container?.closest?.('article, [role="dialog"], section') as Element | null) ||
      container ||
      doc.body;
    if (!scope) return null;
    const matchFromHref = (href: string): string | null =>
      href.match(/(?:^|\/)(?:reel|reels|p)\/([a-zA-Z0-9_-]{4,64})(?:\/|$)/i)?.[1] || null;

    for (const a of Array.from(scope.querySelectorAll('a[href]'))) {
      const found = matchFromHref(a.getAttribute('href') || '');
      if (found) return found;
    }
    for (const timeEl of Array.from(scope.querySelectorAll('time'))) {
      const parentHref = timeEl.closest?.('a[href]')?.getAttribute('href') || '';
      const found = matchFromHref(parentHref);
      if (found) return found;
    }
    return null;
  };

  let shortcode = parsed.shortcode;
  const anyVideo = activeVideo || (doc.querySelector('video') as HTMLVideoElement | null);
  const hasOgVideo = Boolean(
    doc.querySelector('meta[property="og:video"], meta[property="og:type"][content*="video"]')
  );

  if (parsed.kind === 'post') {
    if (!anyVideo && !hasOgVideo) return null;
  } else if (parsed.kind === 'reels_feed') {
    shortcode = findContainerReelShortcode() || 'feed-active';
  } else if (parsed.kind === 'other') {
    if (!anyVideo) return null;
    shortcode = findContainerReelShortcode() || 'feed-active';
  }

  if (!shortcode) return null;
  const canonicalUrl =
    shortcode === 'feed-active'
      ? parsed.canonicalUrl
      : `https://www.instagram.com/reel/${shortcode}/`;

  return {
    videoId: `ig-${shortcode}`,
    canonicalUrl,
  };
}

function extractInstagramCreator(
  doc: Document,
  container: Element,
  rawMetaDesc: string,
  pathname = '',
  allowMetaTitleFallback = true
): string {
  const headerAnchor =
    container.querySelector('header a[href]') ||
    Array.from(container.querySelectorAll('a[href]')).find((el) =>
      Boolean(extractUsernameFromHref(el.getAttribute('href') || ''))
    );
  const handleFromLink = headerAnchor
    ? extractUsernameFromHref(headerAnchor.getAttribute('href') || '')
    : null;
  if (handleFromLink) return handleFromLink;

  const pathAuthor = pathname.match(/^\/([a-zA-Z0-9._]{2,30})\/(?:reel|reels)\//i)?.[1];
  if (pathAuthor && !RESERVED_IG_ROUTES.has(pathAuthor.toLowerCase())) {
    return `@${pathAuthor}`;
  }

  if (allowMetaTitleFallback) {
    const ogTitle =
      doc.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
      doc.querySelector('meta[name="twitter:title"]')?.getAttribute('content') ||
      doc.title ||
      '';
    const atMatch = ogTitle.match(/@([a-zA-Z0-9._]{2,30})/);
    if (atMatch?.[1]) return `@${atMatch[1]}`;

    const onIgMatch = ogTitle.match(/^([^|:•\n]{2,40}?)\s+on Instagram\b/i);
    if (onIgMatch?.[1]) return onIgMatch[1].trim();
  }

  const metaAuthorMatch = rawMetaDesc.match(/-\s*([a-zA-Z0-9._@ ]{2,40}?)\s+on\s+[A-Z][a-z]+\s+\d+/);
  if (metaAuthorMatch?.[1]) {
    const raw = metaAuthorMatch[1].trim();
    return raw.startsWith('@') ? raw : `@${raw.replace(/\s+/g, '')}`;
  }

  return '@instagram-creator';
}

function parseMetaDescriptionCaption(rawMeta: string): string {
  if (!rawMeta) return '';
  const quoted = rawMeta.match(/on\s+[^:]+:\s*["“]([\s\S]+)["”]\.?\s*$/);
  if (quoted?.[1]) return quoted[1].trim();
  return rawMeta.trim();
}

function extractReelCaptionFromContainer(
  container: Element,
  creatorHandle: string,
  metaCaption: string
): { captionText: string; captionEl: Element | null } {
  const h1 = container.querySelector('h1');
  if (h1 && (h1.textContent || '').trim().length >= 8) {
    return { captionText: (h1.textContent || '').trim(), captionEl: h1 };
  }

  const creatorBare = creatorHandle.replace(/^@/, '').toLowerCase();
  const primaryCandidates = Array.from(
    container.querySelectorAll('[data-testid*="caption"], span[dir="auto"], div[dir="auto"]')
  );
  const candidates =
    primaryCandidates.length > 0
      ? primaryCandidates
      : Array.from(container.querySelectorAll('span, p'));

  let bestEl: Element | null = null;
  let bestText = '';
  for (const el of candidates) {
    // Skip elements inside comment list items when scanning main caption
    if (el.closest('ul li') || el.closest('[role="listitem"]')) continue;
    const raw = (el as HTMLElement).innerText || el.textContent || '';
    const cleaned = raw.trim();
    if (cleaned.length < 15 || cleaned.length > 6000) continue;
    if (UI_CHROME_LINE_RE.test(cleaned)) continue;
    if (cleaned.replace(/^@/, '').toLowerCase() === creatorBare) continue;
    if (cleaned.length > bestText.length) {
      bestText = cleaned;
      bestEl = el;
    }
  }

  if (bestText.length >= 15) {
    return { captionText: bestText, captionEl: bestEl };
  }

  // Newer desktop Instagram layouts sometimes place the creator's own caption in the first <li>
  const listItems = Array.from(container.querySelectorAll('ul li, [role="listitem"]')).slice(0, 2);
  for (const li of listItems) {
    const liAuthor = Array.from(li.querySelectorAll('a[href^="/"]'))
      .map((a) => extractUsernameFromHref(a.getAttribute('href') || ''))
      .find(Boolean);
    if (liAuthor && creatorBare !== 'instagram-creator' && liAuthor.replace(/^@/, '').toLowerCase() !== creatorBare) {
      continue;
    }
    const liText = Array.from(li.querySelectorAll('h1, span[dir="auto"], div[dir="auto"]'))
      .map((s) => ((s as HTMLElement).innerText || s.textContent || '').trim())
      .find(
        (t) =>
          t.length >= 15 &&
          t.length <= 6000 &&
          !UI_CHROME_LINE_RE.test(t) &&
          t.replace(/^@/, '').toLowerCase() !== creatorBare
      );
    if (liText) {
      return { captionText: liText, captionEl: li };
    }
  }

  return { captionText: metaCaption, captionEl: null };
}

function extractCreatorOrTopComment(
  container: Element,
  creatorHandle: string,
  captionTextToExclude = ''
): {
  pinnedComment?: DetectedVideoContext['pinnedComment'];
  links: LabeledReferenceLink[];
} {
  const creatorLower = creatorHandle.replace(/^@/, '').toLowerCase();
  const commentItems = Array.from(container.querySelectorAll('ul li, [role="listitem"]'));
  if (commentItems.length === 0) {
    return { links: [] };
  }

  let bestCreatorComment: { author: string; text: string; el: Element } | null = null;
  let bestSubstantiveComment: { author: string; text: string; el: Element; score: number } | null = null;

  for (const item of commentItems.slice(0, 30)) {
    const profileAnchor = Array.from(item.querySelectorAll('a[href^="/"]')).find((a) =>
      Boolean(extractUsernameFromHref(a.getAttribute('href') || ''))
    );
    const author =
      (profileAnchor && extractUsernameFromHref(profileAnchor.getAttribute('href') || '')) ||
      '@commenter';
    const authorLower = author.replace(/^@/, '').toLowerCase();

    const textSpans = Array.from(item.querySelectorAll('span[dir="auto"], div[dir="auto"]'))
      .map((s) => (s.textContent || '').trim())
      .filter(
        (t) =>
          t.length >= 12 &&
          !UI_CHROME_LINE_RE.test(t) &&
          t.replace(/^@/, '').toLowerCase() !== authorLower
      );
    const combinedText = textSpans.join('\n').trim();
    if (!combinedText || combinedText.length < 12) continue;
    if (captionTextToExclude && combinedText === captionTextToExclude.trim()) continue;

    // Ignore one-word DM trigger spam ("AI", "PROMPT", "Link please", "Send")
    if (/^(?:link|pp|prompt|code|send|want|me|please|🔥+|🙌+|👏+|💯+)$/i.test(combinedText)) {
      continue;
    }

    const isCreator = authorLower === creatorLower;
    if (isCreator && (!bestCreatorComment || combinedText.length > bestCreatorComment.text.length)) {
      bestCreatorComment = { author, text: combinedText, el: item };
      continue;
    }

    const hasUrl = /https?:\/\//i.test(combinedText);
    const score = (hasUrl ? 50 : 0) + Math.min(200, combinedText.length);
    if (!bestSubstantiveComment || score > bestSubstantiveComment.score) {
      bestSubstantiveComment = { author, text: combinedText, el: item, score };
    }
  }

  const chosen = bestCreatorComment
    ? { author: bestCreatorComment.author, text: bestCreatorComment.text, isCreator: true, el: bestCreatorComment.el }
    : bestSubstantiveComment && bestSubstantiveComment.score >= 45
      ? {
          author: bestSubstantiveComment.author,
          text: bestSubstantiveComment.text,
          isCreator: false,
          el: bestSubstantiveComment.el,
        }
      : null;

  if (!chosen) return { links: [] };

  const links = extractLabeledLinksFromContainer(chosen.el, chosen.text, 'pinned_comment', 'instagram');
  return {
    pinnedComment: {
      author: chosen.author,
      text: chosen.text.slice(0, 4000),
      isCreator: chosen.isCreator,
    },
    links,
  };
}

function buildHeadlineFromCaption(
  caption: string,
  creatorHandle: string,
  doc: Document
): string {
  const firstLine = caption
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/(?:\s+#[a-z0-9_.-]+)+\s*$/gi, '')
        .replace(/^\s*(?:[\u2022\-*▶👉🔥⚡✅💡🚀]+\s*)+/u, '')
        .trim()
    )
    .find((line) => line.length >= 6 && !/^https?:\/\//i.test(line) && !/^#[a-z0-9_]+/i.test(line));

  if (firstLine) {
    return firstLine.length > 96 ? `${firstLine.slice(0, 93).trim()}...` : firstLine;
  }

  const cleanDocTitle = (doc.title || '')
    .replace(/\s*[•|]\s*Instagram.*$/i, '')
    .replace(/^Instagram\s*$/i, '')
    .trim();
  if (cleanDocTitle.length >= 6) return cleanDocTitle;

  return `Instagram Reel by ${creatorHandle}`;
}

function extractTextTrackCues(
  videoEl: HTMLVideoElement | null
): DetectedVideoContext['transcriptSegments'] {
  if (!videoEl || !videoEl.textTracks || videoEl.textTracks.length === 0) return [];
  const segments: DetectedVideoContext['transcriptSegments'] = [];
  for (let i = 0; i < videoEl.textTracks.length; i++) {
    const track = videoEl.textTracks[i];
    const cues = track?.cues;
    if (!cues || cues.length === 0) continue;
    for (let c = 0; c < cues.length; c++) {
      const cue = cues[c] as unknown as {
        startTime?: number;
        endTime?: number;
        text?: string;
      };
      const text = String(cue?.text || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text) continue;
      const startSeconds = Math.max(0, Number(cue?.startTime || 0));
      const endSeconds = Math.max(startSeconds, Number(cue?.endTime || startSeconds + 2));
      segments.push({
        id: `ig-cue-${segments.length}`,
        startSeconds,
        endSeconds,
        timestampLabel: formatSecondsToTimestamp(startSeconds),
        text,
      });
    }
    if (segments.length > 0) break;
  }
  return segments;
}

interface EmbeddedRelayMetadata {
  username?: string;
  caption?: string;
  durationSeconds?: number;
  subtitlesText?: string;
}

function walkRelayJsonForShortcode(
  node: unknown,
  shortcode: string,
  depth = 0
): EmbeddedRelayMetadata | null {
  if (!node || typeof node !== 'object' || depth > 14) return null;
  if (Array.isArray(node)) {
    for (const item of node.slice(0, 40)) {
      const hit = walkRelayJsonForShortcode(item, shortcode, depth + 1);
      if (hit) return hit;
    }
    return null;
  }

  const rec = node as Record<string, unknown>;
  if (rec.code === shortcode || rec.shortcode === shortcode) {
    const userObj = (rec.user || rec.owner) as { username?: unknown } | undefined;
    const capObj = rec.caption as { text?: unknown } | undefined;
    const subs = Array.isArray(rec.video_subtitles_text)
      ? rec.video_subtitles_text.join(' ')
      : typeof rec.accessibility_caption === 'string'
        ? rec.accessibility_caption
        : undefined;
    return {
      username: typeof userObj?.username === 'string' ? `@${userObj.username}` : undefined,
      caption: typeof capObj?.text === 'string' ? capObj.text : undefined,
      durationSeconds: typeof rec.video_duration === 'number' ? Math.round(rec.video_duration) : undefined,
      subtitlesText: subs,
    };
  }

  for (const val of Object.values(rec)) {
    if (val && typeof val === 'object') {
      const hit = walkRelayJsonForShortcode(val, shortcode, depth + 1);
      if (hit) return hit;
    }
  }
  return null;
}

function extractEmbeddedInstagramRelayData(
  doc: Document,
  shortcode: string
): EmbeddedRelayMetadata | null {
  if (!shortcode || shortcode === 'feed-active' || typeof doc.querySelectorAll !== 'function') {
    return null;
  }
  const scripts = Array.from(doc.querySelectorAll('script[type="application/json"]')).slice(0, 40);
  for (const s of scripts) {
    const raw = s.textContent || '';
    if (!raw || !raw.includes(shortcode)) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      const found = walkRelayJsonForShortcode(parsed, shortcode, 0);
      if (found) return found;
    } catch {
      // Ignore partial or non-JSON script nodes
    }
  }
  return null;
}

/**
 * Extracts all permitted browser-visible Reel context synchronously from the active Instagram tab.
 */
export function extractVisibleInstagramContext(
  doc: Document,
  loc: Location
): DetectedVideoContext | null {
  const activeVideo = findBestVisibleVideo(doc);
  const container = findActiveReelContainer(doc, activeVideo);
  const identity = extractInstagramReelIdentity(doc, loc, container, activeVideo);
  if (!identity) return null;

  const currentShortcode = identity.videoId.replace(/^ig-/, '');
  const relayMeta = extractEmbeddedInstagramRelayData(doc, currentShortcode);

  const ogUrl = doc.querySelector('meta[property="og:url"]')?.getAttribute('content') || '';
  const ogShortcode =
    ogUrl.match(/(?:^|\/)(?:reel|reels|p)\/([a-zA-Z0-9_-]{4,64})(?:\/|$)/i)?.[1] || '';
  const metaIsStale =
    Boolean(ogShortcode) &&
    (currentShortcode === 'feed-active' || ogShortcode !== currentShortcode);

  const rawMetaDesc = metaIsStale
    ? ''
    : doc.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
      doc.querySelector('meta[name="description"]')?.getAttribute('content') ||
      '';
  const metaCaption = parseMetaDescriptionCaption(rawMetaDesc);
  let locPathname = '';
  try {
    locPathname = new URL(loc.href).pathname;
  } catch {
    locPathname = '';
  }
  let creatorHandle = extractInstagramCreator(
    doc,
    container,
    rawMetaDesc,
    locPathname,
    !metaIsStale
  );
  if (creatorHandle === '@instagram-creator' && relayMeta?.username) {
    creatorHandle = relayMeta.username;
  }
  const { captionText, captionEl } = extractReelCaptionFromContainer(
    container,
    creatorHandle,
    relayMeta?.caption || metaCaption
  );
  const effectiveCaption =
    relayMeta?.caption && relayMeta.caption.length > captionText.length
      ? relayMeta.caption
      : captionText;

  const description = effectiveCaption.replace(/\r\n/g, '\n').trim().slice(0, 12000);
  const descLinks = extractLabeledLinksFromContainer(
    captionEl || container,
    description,
    'description',
    'instagram'
  );
  const { pinnedComment, links: commentLinks } = extractCreatorOrTopComment(
    container,
    creatorHandle,
    description
  );

  const labeledLinks: LabeledReferenceLink[] = [];
  const seenUrls = new Set<string>();
  for (const item of [...commentLinks, ...descLinks]) {
    if (seenUrls.has(item.url)) continue;
    seenUrls.add(item.url);
    labeledLinks.push(item);
    if (labeledLinks.length >= 16) break;
  }

  const durationSeconds =
    activeVideo && Number.isFinite(activeVideo.duration) && activeVideo.duration > 0
      ? Math.round(activeVideo.duration)
      : relayMeta?.durationSeconds || 0;
  const transcriptSegments = extractTextTrackCues(activeVideo);
  if (transcriptSegments.length === 0 && relayMeta?.subtitlesText) {
    transcriptSegments.push({
      id: 'ig-relay-sub-0',
      startSeconds: 0,
      endSeconds: Math.max(10, durationSeconds),
      timestampLabel: '00:00',
      text: relayMeta.subtitlesText,
    });
  }
  const isDrmProtected = Boolean(activeVideo && (activeVideo as { mediaKeys?: unknown }).mediaKeys);

  return {
    sourcePlatform: 'instagram',
    videoId: identity.videoId,
    title: buildHeadlineFromCaption(description, creatorHandle, doc),
    channelName: creatorHandle,
    durationSeconds,
    pageUrl: identity.canonicalUrl,
    captionLanguage: doc.documentElement.lang || 'en',
    description,
    pinnedComment,
    labeledLinks,
    chapters: [],
    transcriptSegments,
    captionsAccessible: transcriptSegments.length > 0,
    isDrmProtected,
  };
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function expandReelCaptionIfCollapsed(container: Element): Promise<boolean> {
  const buttons = Array.from(
    container.querySelectorAll('button, [role="button"], span[role="button"], span, div')
  );
  for (const btn of buttons) {
    if (btn.closest('a[href]')) continue;
    const isNativeTrigger =
      btn.tagName === 'BUTTON' || btn.getAttribute('role') === 'button';
    if (!isNativeTrigger && (btn as HTMLElement).children?.length > 1) continue;
    const text = (btn.textContent || '').trim();
    if (/^(?:…|\.\.\.)?\s*(?:more|see more|afficher la suite|plus)$/i.test(text)) {
      (btn as HTMLElement).click();
      await sleepMs(260);
      return true;
    }
  }
  return false;
}

/**
 * Expands truncated Reel captions if possible and extracts full browser-visible context.
 */
export async function extractVisibleInstagramContextAsync(
  doc: Document,
  loc: Location
): Promise<DetectedVideoContext | null> {
  const activeVideo = findBestVisibleVideo(doc);
  const container = findActiveReelContainer(doc, activeVideo);
  const identity = extractInstagramReelIdentity(doc, loc, container, activeVideo);
  if (!identity) return null;

  await expandReelCaptionIfCollapsed(container);
  return extractVisibleInstagramContext(doc, loc);
}

/**
 * Captures the active Reel video frame via canvas when CORS permits (null triggers visibleTab fallback).
 */
export function captureActiveInstagramFrame(doc: Document): CapturedVideoFrame | null {
  return captureVideoFrameFromElement(doc, findBestVisibleVideo(doc));
}

const IG_BUTTON_ID = 'skillloom-instagram-btn';

export function syncInstagramTurnIntoSkillButton(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const existing = document.getElementById(IG_BUTTON_ID) as HTMLButtonElement | null;
  const context = extractVisibleInstagramContext(document, window.location);

  if (!context) {
    existing?.remove();
    return;
  }
  if (existing) return;

  const btn = document.createElement('button');
  btn.id = IG_BUTTON_ID;
  btn.type = 'button';

  const badgeIcon = document.createElement('span');
  badgeIcon.textContent = '⚡';
  const label = document.createElement('span');
  label.textContent = 'Turn Reel into Skill';
  btn.append(badgeIcon, label);

  btn.style.cssText = [
    'position: fixed',
    'top: 76px',
    'right: 20px',
    'z-index: 2147483640',
    'height: 36px',
    'padding: 0 14px',
    'border-radius: 999px',
    'border: 1px solid rgba(45, 212, 191, 0.45)',
    'background: rgba(15, 23, 42, 0.92)',
    'backdrop-filter: blur(8px)',
    'color: #f8fafc',
    'font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    'font-size: 12.5px',
    'font-weight: 600',
    'cursor: pointer',
    'display: inline-flex',
    'align-items: center',
    'gap: 6px',
    'box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35)',
    'transition: transform 140ms ease, border-color 140ms ease',
  ].join(';');

  btn.addEventListener('mouseenter', () => {
    btn.style.borderColor = '#2dd4bf';
    btn.style.transform = 'translateY(-1px)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.borderColor = 'rgba(45, 212, 191, 0.45)';
    btn.style.transform = '';
  });

  btn.addEventListener('click', () => {
    label.textContent = 'Extracting Reel...';
    btn.disabled = true;

    const chromeRuntime = (globalThis as {
      chrome?: { runtime?: { sendMessage: (msg: unknown, cb: (res: unknown) => void) => void } };
    }).chrome?.runtime;

    extractVisibleInstagramContextAsync(document, window.location)
      .then(async (extracted) => {
        if (!extracted || !chromeRuntime) {
          label.textContent = 'Open SkillLoom Popup';
          return;
        }
        const storyboard = await autoCaptureVideoStoryboard(
          document,
          findBestVisibleVideo(document),
          12
        );
        if (storyboard.frames.length > 0) {
          extracted.capturedFrames = storyboard.frames;
        }
        chromeRuntime.sendMessage({ type: 'OPEN_SKILL_STUDIO', payload: extracted }, (response) => {
          const res = response as { ok?: boolean } | undefined;
          label.textContent = res?.ok ? 'Opened Studio ✓' : 'Open SkillLoom Popup';
        });
      })
      .catch(() => {
        label.textContent = 'Open SkillLoom Popup';
      })
      .finally(() => {
        setTimeout(() => {
          btn.disabled = false;
          label.textContent = 'Turn Reel into Skill';
        }, 2800);
      });
  });

  document.body.appendChild(btn);
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  syncInstagramTurnIntoSkillButton();

  let lastObservedHref = window.location.href;
  const handleRouteCheck = () => {
    if (window.location.href !== lastObservedHref) {
      lastObservedHref = window.location.href;
      syncInstagramTurnIntoSkillButton();
    } else if (
      /(?:^|\/)(?:reel|reels|p)(?:\/|$)/i.test(window.location.pathname) ||
      Boolean(document.querySelector('video'))
    ) {
      syncInstagramTurnIntoSkillButton();
    }
  };

  window.addEventListener('popstate', handleRouteCheck);
  const navPoll = window.setInterval(handleRouteCheck, 900);
  window.addEventListener('beforeunload', () => window.clearInterval(navPoll));

  const runtimeState = globalThis as { __skillloomIgListenerBound?: boolean };
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

  if (chromeRuntime?.onMessage && !runtimeState.__skillloomIgListenerBound) {
    runtimeState.__skillloomIgListenerBound = true;
    chromeRuntime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'GET_ACTIVE_VIDEO') {
        extractVisibleInstagramContextAsync(document, window.location)
          .then((data) => {
            const vid = findBestVisibleVideo(document);
            sendResponse({
              ok: Boolean(data),
              data,
              playback: vid
                ? { paused: Boolean(vid.paused || vid.ended), muted: Boolean(vid.muted || vid.volume === 0) }
                : undefined,
              reason: data
                ? undefined
                : `No active Instagram Reel detected on ${window.location.pathname}. Open a Reel or play a video.`,
            });
          })
          .catch((err: unknown) => {
            const syncFallback = extractVisibleInstagramContext(document, window.location);
            sendResponse({
              ok: Boolean(syncFallback),
              data: syncFallback,
              reason: err instanceof Error ? err.message : 'Unable to extract Reel DOM.',
            });
          });
        return true;
      }
      if (msg.type === 'PREPARE_VIDEO_FOR_AUDIO') {
        const vid = findBestVisibleVideo(document);
        if (!vid) {
          sendResponse({ ok: false, muted: true, paused: true });
          return false;
        }
        try {
          vid.muted = false;
          if (vid.volume === 0) vid.volume = 1;
        } catch {
          // Ignore strict media policy errors
        }
        if (vid.muted) {
          const scope = findActiveReelContainer(document, vid);
          const audioBtn = scope.querySelector(
            'button[aria-label*="Audio" i], button[aria-label*="audio" i], button[aria-label*="Sound" i], button[aria-label*="Mute" i], [role="button"][aria-label*="audio" i], [role="button"][aria-label*="sound" i]'
          ) as HTMLElement | null;
          audioBtn?.click();
        }
        if (vid.paused) {
          try {
            const playResult = vid.play();
            if (playResult && typeof playResult.catch === 'function') {
              playResult.catch(() => {});
            }
          } catch {
            // User click on page may still be needed
          }
        }
        sendResponse({
          ok: true,
          muted: Boolean(vid.muted || vid.volume === 0),
          paused: Boolean(vid.paused || vid.ended),
        });
        return false;
      }
      if (msg.type === 'AUTO_CAPTURE_STORYBOARD') {
        const vid = findBestVisibleVideo(document);
        autoCaptureVideoStoryboard(document, vid, msg.maxFrames || 12)
          .then((result) =>
            sendResponse({
              ok: result.frames.length > 0,
              ...result,
            })
          )
          .catch(() =>
            sendResponse({
              ok: false,
              frames: [],
              taintedOrBlocked: true,
              durationSeconds: 0,
              originalTime: 0,
              wasPaused: true,
            })
          );
        return true;
      }
      if (msg.type === 'SEEK_VIDEO_TIMESTAMP') {
        const vid = findBestVisibleVideo(document);
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
            sendResponse({
              ok,
              timestampSeconds: sec,
              timestampLabel: formatSecondsToTimestamp(sec),
            });
          })
          .catch(() => sendResponse({ ok: false }));
        return true;
      }
      if (msg.type === 'RESTORE_VIDEO_STATE') {
        const vid = findBestVisibleVideo(document);
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
        const frame = captureActiveInstagramFrame(document);
        sendResponse({ ok: Boolean(frame), frame });
        return false;
      }
      return false;
    });
  }
}
