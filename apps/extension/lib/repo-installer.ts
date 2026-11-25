/**
 * Persistent Browser-Native Skills Repository Installer
 * Stores the user's chosen FileSystemDirectoryHandle in IndexedDB once, then installs
 * compiled SkillLoom skills (`<slug>/SKILL.md`, `references/`, `evals/`) straight into
 * that folder on every future capture with zero `.zip` or `.json` juggling.
 */
import type { BrowserGeneratedSkillPackage } from './browser-skill-builder';

export interface WritableFileLike {
  write: (data: string | Uint8Array) => Promise<void>;
  close: () => Promise<void>;
}

export interface DirectoryHandleLike {
  name: string;
  queryPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  getDirectoryHandle: (name: string, opts?: { create?: boolean }) => Promise<DirectoryHandleLike>;
  getFileHandle: (
    name: string,
    opts?: { create?: boolean }
  ) => Promise<{ createWritable: () => Promise<WritableFileLike> }>;
}

const DB_NAME = 'skillloom-settings-db';
const STORE_NAME = 'handles';
const REPO_HANDLE_KEY = 'skillsRepoDir';

function openHandleDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function loadSavedSkillsRepoHandle(): Promise<DirectoryHandleLike | null> {
  const db = await openHandleDb();
  if (!db) return null;
  try {
    return await new Promise<DirectoryHandleLike | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const getReq = tx.objectStore(STORE_NAME).get(REPO_HANDLE_KEY);
      getReq.onsuccess = () => resolve((getReq.result as DirectoryHandleLike | undefined) || null);
      getReq.onerror = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export async function saveSkillsRepoHandle(handle: DirectoryHandleLike): Promise<boolean> {
  const db = await openHandleDb();
  if (!db) return false;
  try {
    return await new Promise<boolean>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const putReq = tx.objectStore(STORE_NAME).put(handle, REPO_HANDLE_KEY);
      putReq.onsuccess = () => resolve(true);
      putReq.onerror = () => resolve(false);
    });
  } finally {
    db.close();
  }
}

export async function pickAndSaveSkillsRepoHandle(): Promise<{
  ok: boolean;
  handle?: DirectoryHandleLike;
  error?: string;
}> {
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<DirectoryHandleLike>;
    }
  ).showDirectoryPicker;

  if (!picker) {
    return {
      ok: false,
      error: 'Folder Access API is unavailable here; use Download .zip or Copy Skill Prompt instead.',
    };
  }

  try {
    const handle = await picker({ mode: 'readwrite' });
    await saveSkillsRepoHandle(handle);
    return { ok: true, handle };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: 'Folder picker cancelled.' };
    }
    const msg = err instanceof Error ? err.message : String(err);
    const isRestrictedDotFolder = /system files|not allowed|security/i.test(msg);
    return {
      ok: false,
      error: isRestrictedDotFolder
        ? 'Chrome/Edge blocks direct access to hidden dot-folders (.gemini / .claude). Pick a standard folder (e.g. Documents/Skills) or use Plan B: Copy Skill Prompt.'
        : msg,
    };
  }
}

export async function ensureReadWritePermission(handle: DirectoryHandleLike): Promise<boolean> {
  if (handle.queryPermission) {
    const current = await handle.queryPermission({ mode: 'readwrite' });
    if (current === 'granted') return true;
  }
  if (handle.requestPermission) {
    const requested = await handle.requestPermission({ mode: 'readwrite' });
    return requested === 'granted';
  }
  return true;
}

/**
 * Installs compiled skill package files directly into `<repoRoot>/<pkg.slug>/`.
 */
export async function installSkillPackageToDirectoryHandle(
  pkg: BrowserGeneratedSkillPackage,
  repoRoot: DirectoryHandleLike
): Promise<{ installedPath: string; fileCount: number }> {
  const skillDir = await repoRoot.getDirectoryHandle(pkg.slug, { create: true });
  const installFiles = pkg.files.filter((f) => f.relativePath !== 'skillloom-bundle.json');

  for (const file of installFiles) {
    const parts = file.relativePath.split('/');
    let targetDir = skillDir;
    for (let i = 0; i < parts.length - 1; i++) {
      targetDir = await targetDir.getDirectoryHandle(parts[i], { create: true });
    }
    const fileHandle = await targetDir.getFileHandle(parts[parts.length - 1], { create: true });
    const writable = await fileHandle.createWritable();
    if (file.binaryBytes) {
      const copy = new Uint8Array(file.binaryBytes.byteLength);
      copy.set(file.binaryBytes);
      await writable.write(copy);
    } else {
      await writable.write(file.content);
    }
    await writable.close();
  }

  return {
    installedPath: `${repoRoot.name}/${pkg.slug}/`,
    fileCount: installFiles.length,
  };
}
