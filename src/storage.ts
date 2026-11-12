// Saves maps in localStorage so they persist between visits.
import { type MindMapDoc, parseDoc } from './model';

const PREFIX = 'foxmap:map:';
const LAST = 'foxmap:last';

/** One-time move of maps saved under the app's old name (MindFox). */
export function migrateLegacy(): void {
  try {
    const OLD = 'mindfox:map:';
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(OLD)) keys.push(k);
    }
    for (const k of keys) {
      const nk = PREFIX + k.slice(OLD.length);
      if (localStorage.getItem(nk) === null) localStorage.setItem(nk, localStorage.getItem(k)!);
      localStorage.removeItem(k);
    }
    const last = localStorage.getItem('mindfox:last');
    if (last !== null) {
      if (localStorage.getItem(LAST) === null) localStorage.setItem(LAST, last);
      localStorage.removeItem('mindfox:last');
    }
  } catch {
    /* storage unavailable */
  }
}

export interface MapInfo {
  id: string;
  title: string;
  updatedAt: number;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function saveMap(doc: MindMapDoc): void {
  safe(() => localStorage.setItem(PREFIX + doc.id, JSON.stringify(doc)), undefined);
}

export function loadMap(id: string): MindMapDoc | null {
  return safe(() => {
    const raw = localStorage.getItem(PREFIX + id);
    return raw ? parseDoc(JSON.parse(raw)) : null;
  }, null);
}

export function deleteMap(id: string): void {
  safe(() => localStorage.removeItem(PREFIX + id), undefined);
}

export function listMaps(): MapInfo[] {
  return safe(() => {
    const out: MapInfo[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      try {
        const d = JSON.parse(localStorage.getItem(k)!);
        out.push({ id: d.id, title: d.title || 'Untitled', updatedAt: d.updatedAt || 0 });
      } catch {
        /* skip corrupt entries */
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }, []);
}

export function getLast(): string | null {
  return safe(() => localStorage.getItem(LAST), null);
}
export function setLast(id: string): void {
  safe(() => localStorage.setItem(LAST, id), undefined);
}
