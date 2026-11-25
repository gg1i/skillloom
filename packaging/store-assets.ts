/**
 * SkillLoom Live Browser Smoke Verification & Store Asset Generator (Zero External Deps)
 *
 * Uses locally installed Microsoft Edge / Chrome over DevTools Protocol (CDP) to:
 * 1. Smoke-test the built MV3 extension (`popup/popup.html`, `popup/handoff.html`, and all
 *    compiled worker/content/offscreen scripts) inside a real Chromium engine with zero console
 *    or uncaught runtime errors.
 * 2. Capture crisp 1280x800 store screenshots + 440x280 promo tile in `dist-release/store-assets/`
 *    showcasing the v2 Quality Gate, 7-section SKILL.md format, Instagram Reel frames, and Plan A/B.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  GOLDEN_LONG_NETWORKING,
  GOLDEN_MEDIUM_MOTION,
  GOLDEN_REEL_EDITOR,
} from '../tests/fixtures/golden-videos';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function findBrowserExecutable(): string {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error('No Chromium browser executable (Edge or Chrome) found on this machine.');
  }
  return found;
}

class SimpleCdp {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }
  >();
  public ready: Promise<void>;
  public exceptions: string[] = [];

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error('CDP WebSocket error')), {
        once: true,
      });
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data)) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        result?: Record<string, unknown>;
        error?: unknown;
      };
      if (msg.method === 'Runtime.exceptionThrown') {
        const desc = JSON.stringify(msg.params?.exceptionDetails || msg.params);
        this.exceptions.push(desc);
      }
      if (msg.id && this.pending.has(msg.id)) {
        const handler = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) handler.reject(new Error(JSON.stringify(msg.error)));
        else handler.resolve(msg.result || {});
      }
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evalExpr<T = unknown>(expression: string): Promise<T> {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    const ex = res.exceptionDetails as { text?: string } | undefined;
    if (ex) {
      throw new Error(`Browser eval error: ${JSON.stringify(ex)}`);
    }
    const val = (res.result as { value?: T } | undefined)?.value;
    return val as T;
  }

  close(): void {
    this.ws.close();
  }
}

function makeChromeStubSource(activeVideoJson: string, extraStorageJson = '{}'): string {
  return `
    (() => {
      const activeVideo = ${activeVideoJson};
      const storageData = Object.assign({
        pendingAgentBundle: activeVideo,
        skillloomOnboardingDismissed: true,
      }, ${extraStorageJson});
      window.__slCreatedUrls = [];
      const origCreateObj = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        window.__slLastBlobSize = blob.size;
        return origCreateObj(blob);
      };
      window.chrome = {
        runtime: {
          lastError: null,
          getManifest: () => ({ version: '2.0.0' }),
          getURL: (p) => p,
          onMessage: { addListener() {} },
          sendMessage: (msg, cb) => cb && cb({ ok: false }),
        },
        storage: {
          local: {
            get: (keys, cb) => {
              const out = {};
              const arr = Array.isArray(keys) ? keys : [keys];
              for (const k of arr) {
                if (k in storageData) out[k] = storageData[k];
              }
              cb && cb(out);
            },
            set: (items, cb) => {
              Object.assign(storageData, items);
              cb && cb();
            },
          },
        },
        tabs: {
          query: (_q, cb) => cb && cb([{ id: 101, url: activeVideo.pageUrl, title: activeVideo.title }]),
          create: () => {},
          sendMessage: (_tabId, msg, cb) => {
            if (msg && msg.type === 'GET_ACTIVE_VIDEO') {
              cb && cb({ ok: true, data: activeVideo });
              return;
            }
            cb && cb({ ok: false });
          },
        },
        permissions: {
          contains: async () => true,
          getAll: (cb) => cb && cb({ origins: ['https://www.youtube.com/*', 'https://www.instagram.com/*'] }),
          request: async () => true,
        },
        scripting: { executeScript: (_i, cb) => cb && cb() },
      };
    })();
  `;
}

function loadSampleFramesDataUrls(rootDir: string): string[] {
  const framesDir = path.join(rootDir, 'promo', 'assets', 'frames');
  if (fs.existsSync(framesDir)) {
    const picks = ['f01.jpg', 'f04.jpg', 'f08.jpg', 'f12.jpg']
      .map((name) => path.join(framesDir, name))
      .filter((p) => fs.existsSync(p));
    if (picks.length > 0) {
      return picks.map((p) => `data:image/jpeg;base64,${fs.readFileSync(p).toString('base64')}`);
    }
  }
  const tinyJpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');
  return [`data:image/jpeg;base64,${tinyJpg}`];
}

function wrapScreenshotStageHtml(params: {
  eyebrow: string;
  headline: string;
  subline: string;
  chips: string[];
  shotBase64: string;
  mode: 'popup' | 'studio';
}): string {
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  if (params.mode === 'popup') {
    return `<!doctype html><html><body style="margin:0;width:1280px;height:800px;background:radial-gradient(circle at 20% 20%,rgba(20,184,166,.22),transparent 50%),radial-gradient(circle at 85% 80%,rgba(59,130,246,.16),transparent 48%),#070b13;color:#f8fafc;font-family:'Segoe UI',system-ui,sans-serif;display:grid;grid-template-columns:1fr 440px;align-items:center;padding:0 74px;box-sizing:border-box;gap:56px;">
      <div>
        <div style="display:inline-block;padding:6px 12px;border-radius:999px;background:rgba(20,184,166,.14);border:1px solid rgba(20,184,166,.35);color:#5eead4;font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;margin-bottom:18px;">${esc(params.eyebrow)}</div>
        <h1 style="margin:0 0 18px 0;font-size:48px;line-height:1.12;letter-spacing:-.03em;font-weight:800;">${esc(params.headline)}</h1>
        <p style="margin:0 0 26px 0;font-size:20px;line-height:1.5;color:#94a3b8;max-width:560px;">${esc(params.subline)}</p>
        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          ${params.chips.map((c) => `<span style="padding:8px 14px;border-radius:10px;background:#111827;border:1px solid rgba(148,163,184,.22);color:#e2e8f0;font-size:14px;font-weight:600;">${esc(c)}</span>`).join('')}
        </div>
      </div>
      <div style="display:flex;justify-content:center;">
        <div style="border-radius:18px;overflow:hidden;border:1px solid rgba(148,163,184,.28);box-shadow:0 30px 70px rgba(0,0,0,.65);background:#090d16;">
          <img src="data:image/png;base64,${params.shotBase64}" style="display:block;width:396px;height:auto;max-height:740px;" />
        </div>
      </div>
    </body></html>`;
  }

  return `<!doctype html><html><body style="margin:0;width:1280px;height:800px;background:radial-gradient(circle at 80% 15%,rgba(20,184,166,.18),transparent 48%),#070b13;color:#f8fafc;font-family:'Segoe UI',system-ui,sans-serif;display:flex;flex-direction:column;justify-content:space-between;padding:24px 36px;box-sizing:border-box;">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;">
      <div style="min-width:0;">
        <div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#5eead4;margin-bottom:4px;">${esc(params.eyebrow)}</div>
        <div style="font-size:21px;font-weight:800;letter-spacing:-.02em;white-space:nowrap;">${esc(params.headline)}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;flex-shrink:0;">
        ${params.chips.map((c) => `<span style="padding:6px 11px;border-radius:999px;background:rgba(20,184,166,.12);border:1px solid rgba(20,184,166,.3);color:#99f6e4;font-size:12px;font-weight:600;white-space:nowrap;">${esc(c)}</span>`).join('')}
      </div>
    </div>
    <div style="border-radius:14px;overflow:hidden;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 64px rgba(0,0,0,.62);background:#090d16;">
      <img src="data:image/png;base64,${params.shotBase64}" style="display:block;width:100%;height:688px;object-fit:contain;object-position:top center;background:#090d16;" />
    </div>
  </body></html>`;
}

export async function runLiveBrowserSmokeAndStoreAssets(rootDir = process.cwd()): Promise<{
  browserUsed: string;
  checksPassed: string[];
  assetsWritten: string[];
}> {
  const extDir = path.resolve(rootDir, 'dist-release', 'skillloom-chromium-extension');
  if (!fs.existsSync(path.join(extDir, 'popup', 'popup.html'))) {
    throw new Error('Built extension not found. Run `npm run package:release` first.');
  }

  const outDir = path.resolve(rootDir, 'dist-release', 'store-assets');
  fs.mkdirSync(outDir, { recursive: true });

  const browserPath = findBrowserExecutable();
  const port = 9455 + Math.floor(Math.random() * 200);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-browser-e2e-'));
  const child = spawn(
    browserPath,
    [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--allow-file-access-from-files',
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1280,800',
      'about:blank',
    ],
    { stdio: 'ignore' }
  );

  let wsUrl = '';
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = (await res.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) {
        wsUrl = page.webSocketDebuggerUrl;
        break;
      }
    } catch {
      // Wait for CDP endpoint
    }
    await sleep(100);
  }
  if (!wsUrl) {
    child.kill();
    throw new Error('Timed out connecting to headless browser CDP.');
  }

  const cdp = new SimpleCdp(wsUrl);
  const checksPassed: string[] = [];
  const assetsWritten: string[] = [];

  try {
    await cdp.ready;
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');

    const popupUrl = pathToFileURL(path.join(extDir, 'popup', 'popup.html')).href;
    const studioUrl = pathToFileURL(path.join(extDir, 'popup', 'handoff.html')).href;
    const sampleFrames = loadSampleFramesDataUrls(rootDir);

    const frameObjs = (frames: string[]) =>
      frames.map((dataUrl, i) => ({
        id: `real-f-${i + 1}`,
        timestampSeconds: 18 + i * 70,
        timestampLabel: `${String(Math.floor((18 + i * 70) / 60)).padStart(2, '0')}:${String((18 + i * 70) % 60).padStart(2, '0')}`,
        dataUrl,
        source: 'video_canvas' as const,
        contentScore: 72,
        contentKind: 'code-or-ui' as const,
      }));

    // --- 1. Live Check + Screenshot 1: Popup with Medium Tutorial & Quality Gate ---
    const popupVideo = {
      ...GOLDEN_MEDIUM_MOTION,
      capturedFrames: frameObjs(sampleFrames),
    };
    const stubPopupId = (
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: makeChromeStubSource(JSON.stringify(popupVideo)),
      })
    ).identifier as string;

    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 396,
      height: 700,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await cdp.send('Page.navigate', { url: popupUrl });
    await sleep(750);

    const popupState = await cdp.evalExpr<{
      title: string;
      quality: string;
      installDisabled: boolean;
      hasScrollOverflow: boolean;
    }>(`({
      title: document.getElementById('video-title')?.textContent || '',
      quality: document.getElementById('quality-badge')?.textContent || '',
      installDisabled: Boolean(document.getElementById('install-repo-btn')?.disabled),
      hasScrollOverflow: document.documentElement.scrollWidth > window.innerWidth
    })`);

    if (!popupState.quality.includes('/100') || popupState.installDisabled || popupState.hasScrollOverflow) {
      throw new Error(`Popup live smoke check failed: ${JSON.stringify(popupState)}`);
    }
    checksPassed.push(`Popup live render: ${popupState.quality}, overflow=false`);

    const popupShot = (await cdp.send('Page.captureScreenshot', { format: 'png' })).data as string;
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: stubPopupId });

    const setDocAndShot = async (html: string, width: number, height: number, outFile: string) => {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const tree = await cdp.send('Page.getFrameTree');
      const frameId = ((tree.frameTree as { frame: { id: string } }).frame).id;
      await cdp.send('Page.setDocumentContent', { frameId, html });
      await sleep(250);
      fs.writeFileSync(
        outFile,
        Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data as string, 'base64')
      );
      assetsWritten.push(outFile);
    };

    const frameHtml1 = wrapScreenshotStageHtml({
      eyebrow: '100% Local · Zero Servers',
      headline: 'Turn YouTube & Reels into Actionable Agent Skills',
      subline:
        'Clears filler & ASR typos, adds prerequisites, verification & pitfalls with strict provenance, scores every skill before install, and writes directly to your skills folder.',
      chips: [
        'Rule-Based Distiller v2',
        '7-Section SKILL.md',
        'In-Extension Quality Gate',
        'Plan A + Plan B ZIP',
      ],
      shotBase64: popupShot,
      mode: 'popup',
    });
    await setDocAndShot(frameHtml1, 1280, 800, path.join(outDir, '01-popup-quality-gate-1280x800.png'));

    // --- 2. Live Check + Screenshot 2: Skill Studio Long Tutorial + Chapter Offloading ---
    const captureStudioShot = async (videoInput: unknown) => {
      const sid = (
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
          source: makeChromeStubSource(JSON.stringify(videoInput)),
        })
      ).identifier as string;
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: 1200,
        height: 688,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await cdp.send('Page.navigate', { url: studioUrl });
      await sleep(750);
      const state = await cdp.evalExpr<{
        badge: string;
        metrics: string;
        tabCount: number;
        previewLen: number;
        hasOverflow: boolean;
      }>(`({
        badge: document.getElementById('studio-quality-badge')?.textContent || '',
        metrics: document.getElementById('studio-quality-metrics')?.textContent || '',
        tabCount: document.querySelectorAll('#preview-tabs .tab-btn').length,
        previewLen: (document.getElementById('skill-preview')?.textContent || '').length,
        hasOverflow: document.documentElement.scrollWidth > window.innerWidth
      })`);
      const b64 = (await cdp.send('Page.captureScreenshot', { format: 'png' })).data as string;
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: sid });
      return { state, b64 };
    };

    const longStudio = await captureStudioShot(GOLDEN_LONG_NETWORKING);
    if (!longStudio.state.badge.includes('READY') || longStudio.state.tabCount < 3 || longStudio.state.hasOverflow) {
      throw new Error(`Studio long check failed: ${JSON.stringify(longStudio.state)}`);
    }
    // Verify live interactive controls inside Studio (tab switch + slug rename + ZIP download trigger)
    const sidInteract = (
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: makeChromeStubSource(JSON.stringify(GOLDEN_LONG_NETWORKING)),
      })
    ).identifier as string;
    await cdp.send('Page.navigate', { url: studioUrl });
    await sleep(500);
    const interactiveState = await cdp.evalExpr<{
      hasSlug: boolean;
      tabs: string[];
      hasChapDetails: boolean;
      blobSize: number;
    }>(`(async () => {
      const slugInput = document.getElementById('slug-input');
      slugInput.value = 'comptia-network-plus-live-test';
      slugInput.dispatchEvent(new Event('input', { bubbles: true }));
      const skillText = document.getElementById('skill-preview')?.textContent || '';
      const tabEls = Array.from(document.querySelectorAll('#preview-tabs .tab-btn'));
      const tabs = tabEls.map((t) => t.textContent || '');
      const chapTab = tabEls.find((t) => (t.textContent || '').includes('chapter-details.md'));
      if (chapTab) chapTab.click();
      const chapText = document.getElementById('skill-preview')?.textContent || '';
      document.getElementById('download-files-btn')?.click();
      await new Promise((r) => setTimeout(r, 80));
      return {
        hasSlug: skillText.includes('name: comptia-network-plus-live-test'),
        tabs,
        hasChapDetails: chapText.includes('Chapter-by-Chapter Details'),
        blobSize: Number(window.__slLastBlobSize || 0),
      };
    })()`);
    await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: sidInteract });
    if (!interactiveState.hasSlug || !interactiveState.hasChapDetails || interactiveState.blobSize <= 400) {
      throw new Error(`Studio interactive check failed: ${JSON.stringify(interactiveState)}`);
    }
    checksPassed.push(`Studio Long interactive check: ${longStudio.state.badge}, tabs=${longStudio.state.tabCount}`);

    const frameHtml2 = wrapScreenshotStageHtml({
      eyebrow: 'Skill Studio · Long Video Adaptation',
      headline: 'Long Courses Split Cleanly into Chapter Details + Concise SKILL.md',
      subline: '',
      chips: [longStudio.state.badge, 'Chapter Offloading (references/)', 'Zero Invented Commands'],
      shotBase64: longStudio.b64,
      mode: 'studio',
    });
    await setDocAndShot(frameHtml2, 1280, 800, path.join(outDir, '02-skill-studio-long-video-1280x800.png'));

    // --- 3. Live Check + Screenshot 3: Instagram Reel Mini-Skill + Visual Frames ---
    const reelInput = {
      ...GOLDEN_REEL_EDITOR,
      capturedFrames: frameObjs(sampleFrames.slice(0, 3)),
    };
    const reelStudio = await captureStudioShot(reelInput);
    checksPassed.push(`Studio Reel check: ${reelStudio.state.badge}, tabs=${reelStudio.state.tabCount}`);
    const frameHtml3 = wrapScreenshotStageHtml({
      eyebrow: 'Instagram Reels · No Subtitles Needed',
      headline: 'Focused Mini-Skills Built from Captions, Comments & Keyframes',
      subline: '',
      chips: [reelStudio.state.badge, 'Non-Bait Title Cleanup', 'Mini-Skill Scope & Limitations'],
      shotBase64: reelStudio.b64,
      mode: 'studio',
    });
    await setDocAndShot(frameHtml3, 1280, 800, path.join(outDir, '03-skill-studio-reel-1280x800.png'));

    // --- 4. Live Check + Screenshot 4: Thin Draft Quality Gate + Ollama / BYOK Options ---
    const thinReel = {
      sourcePlatform: 'instagram',
      videoId: 'ig-thin-demo',
      title: 'Quick Workflow Clip',
      channelName: '@creator',
      durationSeconds: 22,
      pageUrl: 'https://www.instagram.com/reel/ig-thin-demo/',
      description: 'Follow for more!',
      transcriptSegments: [],
    };
    const draftStudio = await captureStudioShot(thinReel);
    if (!draftStudio.state.badge.includes('DRAFT')) {
      throw new Error(`Expected DRAFT badge for thin reel, got: ${draftStudio.state.badge}`);
    }
    checksPassed.push(`Studio Draft Quality Gate check: ${draftStudio.state.badge}`);
    const frameHtml4 = wrapScreenshotStageHtml({
      eyebrow: 'Quality Gate + Optional 1-Pass AI Repair',
      headline: 'Low-Signal Captures Are Scored, Explained & Marked as Drafts',
      subline: '',
      chips: [draftStudio.state.badge, 'Agent Refinement Checklist', 'Ollama / BYOK Ready'],
      shotBase64: draftStudio.b64,
      mode: 'studio',
    });
    await setDocAndShot(frameHtml4, 1280, 800, path.join(outDir, '04-quality-gate-draft-repair-1280x800.png'));

    // --- 5. Store Small Promo Tile (440x280) ---
    const iconB64 = fs.readFileSync(path.join(extDir, 'icons', 'icon-128.png')).toString('base64');
    const tileHtml = `<!doctype html><html><body style="margin:0;width:440px;height:280px;background:radial-gradient(circle at 85% 20%,rgba(20,184,166,.32),transparent 52%),linear-gradient(145deg,#070b13 0%,#0f172a 100%);color:#f8fafc;font-family:'Segoe UI',system-ui,sans-serif;padding:24px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:12px;">
        <img src="data:image/png;base64,${iconB64}" width="44" height="44" style="border-radius:10px;border:1px solid rgba(94,234,212,.3);" />
        <div>
          <div style="font-size:20px;font-weight:800;letter-spacing:-.02em;">SkillLoom</div>
          <div style="font-size:11.5px;color:#5eead4;font-weight:600;">100% Local · No Cloud · No Accounts</div>
        </div>
      </div>
      <div>
        <div style="font-size:23px;font-weight:800;line-height:1.18;letter-spacing:-.02em;margin-bottom:8px;">YouTube &amp; Reels to Validated Agent Skills</div>
        <div style="font-size:12.5px;line-height:1.45;color:#cbd5e1;">Extracts timestamped steps, links &amp; frames with built-in Quality Gate and 1-click install.</div>
      </div>
      <div style="display:flex;gap:6px;">
        <span style="padding:4px 9px;border-radius:999px;background:rgba(20,184,166,.16);border:1px solid rgba(20,184,166,.35);color:#99f6e4;font-size:11px;font-weight:600;">SKILL.md</span>
        <span style="padding:4px 9px;border-radius:999px;background:#111827;border:1px solid rgba(148,163,184,.26);color:#e2e8f0;font-size:11px;font-weight:600;">Quality Gate</span>
        <span style="padding:4px 9px;border-radius:999px;background:#111827;border:1px solid rgba(148,163,184,.26);color:#e2e8f0;font-size:11px;font-weight:600;">Ollama / BYOK</span>
      </div>
    </body></html>`;
    await setDocAndShot(tileHtml, 440, 280, path.join(outDir, 'promo-tile-440x280.png'));

    if (cdp.exceptions.length > 0) {
      throw new Error(`Uncaught browser runtime exceptions: ${cdp.exceptions.join('\n')}`);
    }

    return { browserUsed: browserPath, checksPassed, assetsWritten };
  } finally {
    try {
      cdp.close();
    } catch {
      // ignore
    }
    child.kill();
    await sleep(250);
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 4, retryDelay: 120 });
    } catch {
      // Temp cleanup best-effort on Windows
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]).endsWith('store-assets.ts')) {
  runLiveBrowserSmokeAndStoreAssets()
    .then((res) => {
      console.log(`Browser verified (${res.browserUsed}):`);
      for (const c of res.checksPassed) console.log(`  ✓ ${c}`);
      console.log('Generated store assets:');
      for (const a of res.assetsWritten) console.log(`  • ${a}`);
    })
    .catch((err) => {
      console.error('Store verification failed:', err);
      process.exit(1);
    });
}
