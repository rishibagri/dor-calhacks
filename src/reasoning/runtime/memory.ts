/**
 * D055 cross-entry memory, owner-device only. Short facts the model distilled from earlier entries ("wants to reach out
 * to friends more", "exam on Friday"), each with a lifetime. Passed back to /api/reasoning so a new entry is read in
 * context. Never sent to SpacetimeDB, peers or logs. Pure: storage is injected.
 */
export const MEMORY_KINDS = ['goal', 'event', 'preference', 'person', 'feeling'] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export interface MemoryItem {
  id: string;
  kind: MemoryKind;
  text: string;
  /** Pair ref when the fact is about one connection. */
  ref: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface MemoryUpdate {
  add: { kind: MemoryKind; text: string; ref: string | null; ttlDays: number }[];
  /** Ids of remembered facts the new entry makes stale (an exam that already happened, a goal now met). */
  expire: string[];
}

export const MAX_MEMORY = 40;
export const MAX_MEMORY_TEXT = 160;
const MAX_TTL_DAYS = 60;
const DAY_MS = 86_400_000;

export interface MemoryStore { read(): string | null; write(value: string): void }

const isKind = (v: unknown): v is MemoryKind => typeof v === 'string' && (MEMORY_KINDS as readonly string[]).includes(v);

function parse(raw: string | null): MemoryItem[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.filter((m): m is MemoryItem => m && typeof m.id === 'string' && isKind(m.kind) && typeof m.text === 'string' &&
      (m.ref === null || typeof m.ref === 'string') && typeof m.createdAt === 'string' && typeof m.expiresAt === 'string');
  } catch { return []; }
}

/** Live (unexpired) memory, newest first. */
export function readMemory(store: MemoryStore, now: Date): MemoryItem[] {
  return parse(store.read()).filter(m => Date.parse(m.expiresAt) > now.getTime())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_MEMORY);
}

/** Applies a model update: drops expired ids, adds new facts (deduplicated by text), keeps the newest MAX_MEMORY. */
export function applyMemoryUpdate(current: readonly MemoryItem[], update: MemoryUpdate | null, now: Date,
  newId: () => string, knownRefs: ReadonlySet<string>): MemoryItem[] {
  if (!update) return [...current];
  const gone = new Set(update.expire);
  const kept = current.filter(m => !gone.has(m.id));
  const seen = new Set(kept.map(m => m.text.toLowerCase()));
  const added: MemoryItem[] = [];
  for (const a of update.add.slice(0, 8)) {
    const text = a.text.replace(/\s+/g, ' ').trim().slice(0, MAX_MEMORY_TEXT);
    if (!text || !isKind(a.kind) || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    const days = Math.max(1, Math.min(Number.isFinite(a.ttlDays) ? a.ttlDays : 7, MAX_TTL_DAYS));
    added.push({ id: newId(), kind: a.kind, text, ref: a.ref && knownRefs.has(a.ref) ? a.ref : null,
      createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + days * DAY_MS).toISOString() });
  }
  return [...added, ...kept].slice(0, MAX_MEMORY);
}

export function saveMemory(store: MemoryStore, items: readonly MemoryItem[]): void {
  store.write(JSON.stringify(items.slice(0, MAX_MEMORY)));
}

/** How memory is shown to the model: id, kind, age and text; refs only, never names. */
export function memoryForModel(items: readonly MemoryItem[], now: Date): { id: string; kind: MemoryKind; ref: string | null; daysAgo: number; text: string }[] {
  return items.map(m => ({ id: m.id, kind: m.kind, ref: m.ref, daysAgo: Math.max(0, Math.floor((now.getTime() - Date.parse(m.createdAt)) / DAY_MS)), text: m.text }));
}
