/**
 * SkillLoom Chromium MV3 Content Script for X / Twitter (https://x.com/ & https://twitter.com/)
 * Extracts the focal tweet/thread, X Article text, creator handle, outbound links,
 * attached <video> keyframes, and attached tweet media screenshots strictly from visible DOM state.
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
  parseTwitterPostUrl,
  seekVideoElement,
  unwrapRedirectUrl,
} from '../lib/dom-extract-utils';

function extractHandleFromArticle(article: Element): string | null {
  const userNameEl = article.querySelector('[data-testid="User-Name"]');
  if (userNameEl) {
    const text = userNameEl.textContent || '';
    const handleMatch = text.match(/@([a-zA-Z0-9_]{1,30})/);
    if (handleMatch?.[1]) return `@${handleMatch[1]}`;
    for (const a of Array.from(userNameEl.querySelectorAll('a[href]'))) {
      const href = a.getAttribute('href') || '';
      const seg = href.replace(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com/i, '').split('/').filter(Boolean);
      if (seg.length === 1 && /^[a-zA-Z0-9_]{1,30}$/.test(seg[0])) {
        return `@${seg[0]}`;
      }
    }
  }
  return null;
}

function collectArticleTextBlocks(container: Element): string[] {
  const blocks: string[] = [];
  const seen = new Set<string>();
  const textEls = Array.from(
    container.querySelectorAll(
      '[data-testid="tweetText"], [data-testid="twitterArticleReadView"], [data-testid="richTextView"]'
    )
  );
  for (const el of textEls) {
    const txt = (el.textContent || '').replace(/\r\n/g, '\n').trim();
    if (!txt || txt.length < 3 || seen.has(txt)) continue;
    seen.add(txt);
    blocks.push(txt);
  }
  return blocks;
}

function extractTwitterLinksFromArticles(articles: Element[], rawText: string): LabeledReferenceLink[] {
  const combined: LabeledReferenceLink[] = [];
  const seen = new Set<string>();

  for (const article of articles) {
    for (const anchor of Array.from(article.querySelectorAll('a[href]'))) {
      const rawHref = anchor.getAttribute('href') || '';
      const displayText = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
      let candidateUrl: string | null = null;

      if (/^https?:\/\/t\.co\//i.test(rawHref)) {
        // Prefer untruncated display URL over opaque t.co shortlink when readable
        const cleanDisplay = displayText.replace(/…|\.\.\.$/, '').trim();
        if (
          displayText &&
          !/[…]$/.test(displayText) &&
          /^(?:https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(cleanDisplay)
        ) {
          candidateUrl = /^https?:\/\//i.test(cleanDisplay) ? cleanDisplay : `https://${cleanDisplay}`;
        } else {
          candidateUrl = rawHref;
        }
      } else {
        candidateUrl = unwrapRedirectUrl(rawHref, 'twitter');
      }

      if (!candidateUrl || seen.has(candidateUrl)) continue;
      seen.add(candidateUrl);

      let label = displayText;
      if (!label || /^https?:\/\//i.test(label) || label.length > 60) {
        try {
          label = new URL(candidateUrl).hostname.replace(/^www\./, '');
        } catch {
          label = 'Referenced Link';
        }
      }
      combined.push({ label, url: candidateUrl, source: 'description' });
      if (combined.length >= 16) return combined;
    }
  }

  for (const fallback of extractLabeledLinksFromContainer(null, rawText, 'description', 'twitter')) {
    if (!seen.has(fallback.url)) {
      seen.add(fallback.url);
      combined.push(fallback);
    }
  }
  return combined.slice(0, 16);
}

function selectFocalTweetArticle(
  doc: Document,
  statusId: string | null,
  activeVideo: HTMLVideoElement | null
): Element | null {
  const articles = Array.from(doc.querySelectorAll('article[data-testid="tweet"]'));
  if (articles.length === 0) {
    return doc.querySelector('[data-testid="twitterArticleReadView"], main article, main');
  }

  if (statusId) {
    const exactMatch = articles.find((art) =>
      Array.from(art.querySelectorAll('a[href]')).some((a) =>
        (a.getAttribute('href') || '').includes(`/status/${statusId}`)
      )
    );
    if (exactMatch) return exactMatch;
  }

  if (activeVideo) {
    const videoArticle = activeVideo.closest?.('article[data-testid="tweet"]');
    if (videoArticle) return videoArticle;
  }

  // Feed fallback: pick article closest to vertical viewport center
  let best = articles[0];
  let bestDist = Infinity;
  const viewMid = (doc.defaultView?.innerHeight || 800) / 2;
  for (const art of articles) {
    if (typeof art.getBoundingClientRect !== 'function') continue;
    const rect = art.getBoundingClientRect();
    if (rect.height <= 0) continue;
    const mid = rect.top + rect.height / 2;
    const dist = Math.abs(mid - viewMid);
    if (dist < bestDist) {
      bestDist = dist;
      best = art;
    }
  }
  return best;
}

/**
 * Captures attached tweet/thread media images (`pbs.twimg.com/media`) onto local canvas
 * as clean JPEG frames when tweets share code/diagram screenshots or cheat sheets.
 */
function captureTwitterMediaImages(doc: Document, articles: Element[]): CapturedVideoFrame[] {
  const frames: CapturedVideoFrame[] = [];
  const seenSrc = new Set<string>();

  for (const article of articles) {
    const imgs = Array.from(
      article.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]')
    ) as HTMLImageElement[];
    for (const img of imgs) {
      const src = img.currentSrc || img.src || '';
      if (!src || seenSrc.has(src)) continue;
      if (/profile_images|emoji/i.test(src)) continue;
      seenSrc.add(src);
      const w = img.naturalWidth || img.width || 0;
      const h = img.naturalHeight || img.height || 0;
      if (w < 120 || h < 80) continue;
      try {
        const targetW = Math.min(960, w);
        const targetH = Math.max(1, Math.round(h * (targetW / w)));
        const canvas = doc.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.drawImage(img, 0, 0, targetW, targetH);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        if (dataUrl && dataUrl.startsWith('data:image/jpeg')) {
          const idx = frames.length;
          frames.push({
            id: `x-img-${idx + 1}-${Date.now()}`,
            timestampSeconds: idx * 5,
            timestampLabel: `img-${idx + 1}`,
            dataUrl,
            note: img.alt ? `X Image: ${img.alt.slice(0, 80)}` : `X Attached Image #${idx + 1}`,
            source: 'video_canvas',
          });
        }
      } catch {
        // Cross-origin canvas taint fallback handled by visible-tab capture when requested
      }
      if (frames.length >= 6) return frames;
    }
  }
  return frames;
}

/**
 * Extracts visible X/Twitter post, unrolled OP thread, X Article text, links, and media frames
 * without mutating DOM or calling external APIs.
 */
export function extractVisibleTwitterContext(
  doc: Document,
  loc: Location
): DetectedVideoContext | null {
  const parsedUrl = parseTwitterPostUrl(loc.href);
  if (!parsedUrl) return null;

  const activeVideo = findBestVisibleVideo(doc);
  const focalArticle = selectFocalTweetArticle(doc, parsedUrl.statusId, activeVideo);
  if (!focalArticle) return null;

  const opHandle = extractHandleFromArticle(focalArticle) || parsedUrl.username || '@x-creator';
  const allArticles = Array.from(doc.querySelectorAll('article[data-testid="tweet"]'));

  // Unroll OP's thread posts on status pages so full multi-post guides are captured cleanly
  const threadArticles: Element[] = [focalArticle];
  const focalIndex = allArticles.indexOf(focalArticle);
  const otherReplies: Array<{ author: string; text: string }> = [];

  if (focalIndex !== -1 && parsedUrl.statusId) {
    for (let i = focalIndex + 1; i < allArticles.length && threadArticles.length < 18; i++) {
      const art = allArticles[i];
      const author = extractHandleFromArticle(art);
      const texts = collectArticleTextBlocks(art);
      if (texts.length === 0) continue;
      if (author && author.toLowerCase() === opHandle.toLowerCase()) {
        threadArticles.push(art);
      } else if (author && otherReplies.length < 3) {
        otherReplies.push({ author, text: texts.join('\n') });
      }
    }
  }

  const threadPosts: string[] = [];
  for (const art of threadArticles) {
    const blocks = collectArticleTextBlocks(art);
    const joined = blocks.join('\n').trim();
    if (joined) threadPosts.push(joined);
  }

  // Also check long-form X Article container outside standard tweetText nodes
  const articleView = doc.querySelector('[data-testid="twitterArticleReadView"]');
  if (articleView) {
    const articleTxt = (articleView.textContent || '').replace(/\r\n/g, '\n').trim();
    if (articleTxt.length > 40 && !threadPosts.includes(articleTxt)) {
      threadPosts.push(articleTxt);
    }
  }

  const fullText = threadPosts.join('\n\n').trim();
  if (!fullText && !activeVideo) return null;

  const firstLine = (fullText.split(/\r?\n/).find((l) => l.trim().length >= 6) || '').trim();
  const rawTabTitle = (doc.title || '')
    .replace(/\s*\/\s*X\s*$/i, '')
    .replace(/\s+on X:\s*/i, ': ')
    .trim();
  const title =
    firstLine.length >= 8
      ? firstLine.slice(0, 120)
      : rawTabTitle.length >= 6
        ? rawTabTitle.slice(0, 120)
        : `X Workflow by ${opHandle}`;

  const durationSeconds =
    activeVideo && Number.isFinite(activeVideo.duration) ? Math.floor(activeVideo.duration) : 0;

  // Convert thread posts & lines into clean chronological segments
  const transcriptSegments: DetectedVideoContext['transcriptSegments'] = [];
  let cursorSec = 0;
  for (const post of threadPosts) {
    for (const rawLine of post.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.length < 4) continue;
      transcriptSegments.push({
        id: `x-seg-${transcriptSegments.length + 1}`,
        startSeconds: cursorSec,
        endSeconds: cursorSec + 10,
        timestampLabel: formatSecondsToTimestamp(cursorSec),
        text: line,
      });
      cursorSec += 10;
    }
  }

  const labeledLinks = extractTwitterLinksFromArticles(threadArticles, fullText);
  const inlineImages = captureTwitterMediaImages(doc, threadArticles);
  const pinnedReply = otherReplies.sort((a, b) => b.text.length - a.text.length)[0];

  const resolvedId =
    parsedUrl.statusId ||
    Array.from(focalArticle.querySelectorAll('a[href*="/status/"]'))
      .map((a) => (a.getAttribute('href') || '').match(/\/status\/(\d+)/)?.[1])
      .find(Boolean) ||
    'feed-active';

  const canonicalStatusUrl =
    parsedUrl.statusId
      ? parsedUrl.canonicalUrl
      : resolvedId !== 'feed-active'
        ? `https://x.com/${opHandle.replace(/^@/, '')}/status/${resolvedId}`
        : parsedUrl.canonicalUrl;

  return {
    sourcePlatform: 'twitter',
    videoId: `x-${resolvedId}`,
    title,
    channelName: opHandle,
    durationSeconds,
    pageUrl: canonicalStatusUrl,
    captionLanguage: 'en',
    description: fullText,
    ...(pinnedReply
      ? {
          pinnedComment: {
            author: pinnedReply.author,
            text: pinnedReply.text,
            isCreator: false,
          },
        }
      : {}),
    labeledLinks,
    ...(inlineImages.length > 0 ? { capturedFrames: inlineImages } : {}),
    chapters: [],
    transcriptSegments,
    captionsAccessible: transcriptSegments.length > 0,
    isDrmProtected: false,
  };
}

// --- Chromium MV3 Content Script Message Listener ---

const chromeRuntime = (
  globalThis as {
    chrome?: {
      runtime?: {
        onMessage?: {
          addListener: (
            cb: (
              msg: { type?: string; targetSeconds?: number; resumePlay?: boolean; maxFrames?: number },
              _sender: unknown,
              sendResponse: (res: unknown) => void
            ) => boolean | void
          ) => void;
        };
      };
    };
  }
).chrome?.runtime;

if (typeof document !== 'undefined' && typeof window !== 'undefined' && chromeRuntime?.onMessage) {
  const guardKey = '__skillloomTwitterListenerAttached';
  const win = window as unknown as Record<string, boolean>;
  if (!win[guardKey]) {
    win[guardKey] = true;
    chromeRuntime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg.type === 'GET_ACTIVE_VIDEO') {
        try {
          const data = extractVisibleTwitterContext(document, window.location);
          const vid = findBestVisibleVideo(document);
          sendResponse({
            ok: Boolean(data),
            data,
            playback: vid
              ? { paused: Boolean(vid.paused || vid.ended), muted: Boolean(vid.muted || vid.volume === 0) }
              : undefined,
            reason: data
              ? undefined
              : 'No X / Twitter post or thread detected here. Open an X post (/status/...) or scroll a post into view.',
          });
        } catch (err: unknown) {
          sendResponse({
            ok: false,
            reason: err instanceof Error ? err.message : 'Unable to inspect X post DOM.',
          });
        }
        return false;
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
          // ignore
        }
        if (vid.paused) {
          try {
            const p = vid.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
          } catch {
            // ignore
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
        const parsed = parseTwitterPostUrl(window.location.href);
        const vid = findBestVisibleVideo(document);
        const focal = selectFocalTweetArticle(document, parsed?.statusId || null, vid);
        const attachedImgs = focal ? captureTwitterMediaImages(document, [focal]) : [];

        if (!vid || !(vid.duration > 0.5)) {
          sendResponse({
            ok: attachedImgs.length > 0,
            frames: attachedImgs,
            taintedOrBlocked: attachedImgs.length === 0,
            durationSeconds: 0,
            originalTime: 0,
            wasPaused: true,
          });
          return false;
        }

        autoCaptureVideoStoryboard(document, vid, msg.maxFrames || 12)
          .then((result) => {
            const merged = [...attachedImgs, ...result.frames].slice(0, msg.maxFrames || 12);
            sendResponse({
              ok: merged.length > 0,
              ...result,
              frames: merged,
            });
          })
          .catch(() =>
            sendResponse({
              ok: attachedImgs.length > 0,
              frames: attachedImgs,
              taintedOrBlocked: attachedImgs.length === 0,
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
        if (!vid.paused && typeof vid.pause === 'function') vid.pause();
        seekVideoElement(vid, msg.targetSeconds)
          .then((ok) => {
            const sec = Math.max(0, Math.floor(vid.currentTime || 0));
            sendResponse({ ok, timestampSeconds: sec, timestampLabel: formatSecondsToTimestamp(sec) });
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
        const vid = findBestVisibleVideo(document);
        const videoFrame = vid ? captureVideoFrameFromElement(document, vid) : null;
        if (videoFrame) {
          sendResponse({ ok: true, frame: videoFrame });
          return false;
        }
        const parsed = parseTwitterPostUrl(window.location.href);
        const focal = selectFocalTweetArticle(document, parsed?.statusId || null, vid);
        const imgs = focal ? captureTwitterMediaImages(document, [focal]) : [];
        sendResponse({ ok: imgs.length > 0, frame: imgs[0] || null });
        return false;
      }

      return false;
    });
  }
}
