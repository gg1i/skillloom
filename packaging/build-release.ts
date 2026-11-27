import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import * as esbuild from 'esbuild';

interface ZipEntryInput {
  archivePath: string;
  data: Buffer;
}

interface StoreDistributionConfig {
  version: string;
  productName: string;
  businessModel: string;
  publicationNotice: string;
  stores: Array<{
    id: string;
    browserName: string;
    storeName: string;
    publicationStatus: string;
    extensionId: string;
    storeUrl?: string;
    zipFileName: string;
    notes: string;
  }>;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(buf: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/**
 * Pure-Node RGBA PNG generator for crisp store-valid SkillLoom extension icons (16, 48, 128px).
 */
export function generateSkillLoomIconPng(size: number): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const rawRows: Buffer[] = [];
  const radius = size * 0.18;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const dx = Math.max(radius - x, 0, x - (size - 1 - radius));
      const dy = Math.max(radius - y, 0, y - (size - 1 - radius));
      const outside = dx * dx + dy * dy > radius * radius;
      const idx = 1 + x * 4;
      if (outside) {
        row[idx] = 0;
        row[idx + 1] = 0;
        row[idx + 2] = 0;
        row[idx + 3] = 0;
        continue;
      }

      const nx = x / size;
      const ny = y / size;
      const isBar1 = ny >= 0.24 && ny <= 0.36 && nx >= 0.2 && nx <= 0.8;
      const isBar2 = ny >= 0.45 && ny <= 0.57 && nx >= 0.28 && nx <= 0.72;
      const isBar3 = ny >= 0.66 && ny <= 0.78 && nx >= 0.2 && nx <= 0.8;
      const isAccent = isBar1 || isBar2 || isBar3;

      if (isAccent) {
        row[idx] = isBar2 ? 94 : 15;
        row[idx + 1] = isBar2 ? 234 : 118;
        row[idx + 2] = isBar2 ? 212 : 110;
        row[idx + 3] = 255;
      } else {
        row[idx] = 15;
        row[idx + 1] = 23;
        row[idx + 2] = 42;
        row[idx + 3] = 255;
      }
    }
    rawRows.push(row);
  }

  const compressed = zlib.deflateSync(Buffer.concat(rawRows));
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function buildGenericZip(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.archivePath.replace(/\\/g, '/'), 'utf8');
    const dataBuf = entry.data;
    const checksum = crc32(dataBuf);
    const size = dataBuf.length;

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(size, 18);
    localHeader.writeUInt32LE(size, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuf, dataBuf);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(size, 20);
    centralHeader.writeUInt32LE(size, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0x00000000, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuf);

    offset += localHeader.length + nameBuf.length + dataBuf.length;
  }

  const centralDirBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirBuf, eocd]);
}

function collectFilesRecursively(dir: string, rootDir = dir): ZipEntryInput[] {
  const entries: ZipEntryInput[] = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      entries.push(...collectFilesRecursively(full, rootDir));
    } else {
      entries.push({
        archivePath: path.relative(rootDir, full).replace(/\\/g, '/'),
        data: fs.readFileSync(full),
      });
    }
  }
  return entries;
}

export async function buildReleaseArtifacts(rootDir = process.cwd()): Promise<{
  releaseDir: string;
  extensionDir: string;
  extensionZipPath: string;
  storeZips: Record<string, string>;
  manifestPath: string;
}> {
  const releaseDir = path.resolve(rootDir, 'dist-release');
  const extensionDir = path.join(releaseDir, 'skillloom-chromium-extension');
  const storesDir = path.join(releaseDir, 'stores');

  fs.rmSync(releaseDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  fs.mkdirSync(path.join(extensionDir, 'background'), { recursive: true });
  fs.mkdirSync(path.join(extensionDir, 'content'), { recursive: true });
  fs.mkdirSync(path.join(extensionDir, 'offscreen'), { recursive: true });
  fs.mkdirSync(path.join(extensionDir, 'popup'), { recursive: true });
  fs.mkdirSync(path.join(extensionDir, 'icons'), { recursive: true });
  fs.mkdirSync(storesDir, { recursive: true });

  // 1. Generate store-required PNG icons (16, 48, 128)
  for (const size of [16, 48, 128]) {
    fs.writeFileSync(
      path.join(extensionDir, 'icons', `icon-${size}.png`),
      generateSkillLoomIconPng(size)
    );
  }

  // 2. Compile TypeScript MV3 extension entrypoints into browser-ready JS
  await Promise.all([
    esbuild.build({
      entryPoints: [path.resolve(rootDir, 'apps/extension/background/service-worker.ts')],
      outfile: path.join(extensionDir, 'background/service-worker.js'),
      bundle: true,
      format: 'esm',
      target: ['chrome114', 'edge114'],
      platform: 'browser',
    }),
    esbuild.build({
      entryPoints: [path.resolve(rootDir, 'apps/extension/content/youtube-detector.ts')],
      outfile: path.join(extensionDir, 'content/youtube-detector.js'),
      bundle: true,
      format: 'iife',
      target: ['chrome114', 'edge114'],
      platform: 'browser',
    }),
    esbuild.build({
      entryPoints: [path.resolve(rootDir, 'apps/extension/content/instagram-detector.ts')],
      outfile: path.join(extensionDir, 'content/instagram-detector.js'),
      bundle: true,
      format: 'iife',
      target: ['chrome114', 'edge114'],
      platform: 'browser',
    }),
    esbuild.build({
      entryPoints: [path.resolve(rootDir, 'apps/extension/content/twitter-detector.ts')],
      outfile: path.join(extensionDir, 'content/twitter-detector.js'),
      bundle: true,
      format: 'iife',
      target: ['chrome114', 'edge114'],
      platform: 'browser',
    }),
    esbuild.build({
      entryPoints: [path.resolve(rootDir, 'apps/extension/offscreen/offscreen.ts')],
      outfile: path.join(extensionDir, 'offscreen/offscreen.js'),
      bundle: true,
      format: 'iife',
      target: ['chrome114', 'edge114'],
      platform: 'browser',
    }),
    esbuild.build({
      entryPoints: [path.resolve(rootDir, 'apps/extension/popup/popup.ts')],
      outfile: path.join(extensionDir, 'popup/popup.js'),
      bundle: true,
      format: 'esm',
      target: ['chrome114', 'edge114'],
      platform: 'browser',
    }),
    esbuild.build({
      entryPoints: [path.resolve(rootDir, 'apps/extension/popup/handoff.ts')],
      outfile: path.join(extensionDir, 'popup/handoff.js'),
      bundle: true,
      format: 'esm',
      target: ['chrome114', 'edge114'],
      platform: 'browser',
    }),
  ]);

  const baseManifestRaw = fs.readFileSync(
    path.resolve(rootDir, 'apps/extension/manifest.json'),
    'utf8'
  );
  fs.writeFileSync(path.join(extensionDir, 'manifest.json'), baseManifestRaw, 'utf8');
  fs.copyFileSync(
    path.resolve(rootDir, 'apps/extension/popup/popup.html'),
    path.join(extensionDir, 'popup/popup.html')
  );
  fs.copyFileSync(
    path.resolve(rootDir, 'apps/extension/popup/handoff.html'),
    path.join(extensionDir, 'popup/handoff.html')
  );
  fs.copyFileSync(
    path.resolve(rootDir, 'apps/extension/offscreen/offscreen.html'),
    path.join(extensionDir, 'offscreen/offscreen.html')
  );

  // 3. Build shared Chromium MV3 ZIP archive
  const extensionFiles = collectFilesRecursively(extensionDir);
  const extensionZipPath = path.join(releaseDir, 'skillloom-chromium-mv3-extension.zip');
  fs.writeFileSync(extensionZipPath, buildGenericZip(extensionFiles));

  // 4. Build 4 browser store packages (Chrome Web Store, Edge Add-ons, Brave, Opera Add-ons)
  const distConfig = JSON.parse(
    fs.readFileSync(path.resolve(rootDir, 'packaging/browser-distribution.json'), 'utf8')
  ) as StoreDistributionConfig;
  const storeZips: Record<string, string> = {};

  for (const store of distConfig.stores) {
    const targetDir = path.join(storesDir, store.id);
    fs.cpSync(extensionDir, targetDir, { recursive: true });
    fs.writeFileSync(
      path.join(targetDir, 'STORE-PACKAGE-INFO.json'),
      JSON.stringify(
        {
          storeId: store.id,
          storeName: store.storeName,
          browserName: store.browserName,
          publicationStatus: store.publicationStatus,
          notes: store.notes,
        },
        null,
        2
      ),
      'utf8'
    );
    const storeFiles = collectFilesRecursively(targetDir);
    const zipPath = path.join(storesDir, store.zipFileName);
    fs.writeFileSync(zipPath, buildGenericZip(storeFiles));
    storeZips[store.id] = `dist-release/stores/${store.zipFileName}`;
  }

  // 5. Write release manifest documenting all extension artifacts
  const publishedCount = distConfig.stores.filter((s) => s.publicationStatus === 'PUBLISHED').length;
  const manifestPath = path.join(releaseDir, 'release-manifest.json');
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        product: 'SkillLoom',
        version: distConfig.version,
        architecture: 'extension-only-local-first',
        businessModel: distConfig.businessModel,
        builtAt: new Date().toISOString(),
        publicationStatus:
          publishedCount === distConfig.stores.length
            ? 'PUBLISHED'
            : publishedCount > 0
              ? 'PARTIALLY_PUBLISHED'
              : 'UNPUBLISHED_STORE_SUBMISSION_READY',
        targetBrowsers: distConfig.stores.map((s) => ({
          id: s.id,
          browser: s.browserName,
          storeName: s.storeName,
          publicationStatus: s.publicationStatus,
          ...(s.storeUrl ? { storeUrl: s.storeUrl } : {}),
          zipPath: storeZips[s.id],
        })),
        artifacts: {
          unpackedExtensionDir: 'dist-release/skillloom-chromium-extension',
          extensionStoreZip: 'dist-release/skillloom-chromium-mv3-extension.zip',
          storePackages: storeZips,
        },
        extensionFilesIncluded: extensionFiles.map((f) => f.archivePath),
      },
      null,
      2
    ),
    'utf8'
  );

  return {
    releaseDir,
    extensionDir,
    extensionZipPath,
    storeZips,
    manifestPath,
  };
}

const isMain =
  process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));

if (isMain) {
  buildReleaseArtifacts()
    .then((out) => {
      console.log('SkillLoom extension release artifacts built successfully:');
      console.log(`  - Unpacked Chromium Extension : ${out.extensionDir}`);
      console.log(`  - Shared Chromium MV3 ZIP     : ${out.extensionZipPath}`);
      for (const [storeId, zipRel] of Object.entries(out.storeZips)) {
        console.log(`  - Store Package [${storeId}] : ${zipRel}`);
      }
      console.log(`  - Release Manifest            : ${out.manifestPath}`);
    })
    .catch((err) => {
      console.error('Failed to build release artifacts:', err);
      process.exit(1);
    });
}
