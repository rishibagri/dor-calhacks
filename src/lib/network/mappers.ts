/** Maps network view rows (snake_case or camelCase) to app shapes. Malformed rows are dropped. */
// Pure (no bindings import) so it loads under node --test.
import type {
  ConnectionProfile, FofCard, FofRequestStatus, NudgeRequestStatus, NudgeRequestView, ProfileDetail,
} from './types.ts';

type LooseRow = Record<string, unknown>;
const toCamel = (snake: string): string => snake.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());

const MAX_LIST = 32;

function get(row: LooseRow, snake: string): unknown {
  return row[snake] ?? row[toCamel(snake)];
}

function str(row: LooseRow, key: string): string | null {
  const v = get(row, key);
  if (v === undefined || v === null) return null;
  if (typeof v === 'object') {
    const o = v as { toHexString?: () => string; toISOString?: () => string; toDate?: () => Date };
    if (typeof o.toISOString === 'function') return o.toISOString();
    if (typeof o.toDate === 'function') return o.toDate().toISOString();
    if (typeof o.toHexString === 'function') return o.toHexString();
    return null;
  }
  return String(v);
}

function num(row: LooseRow, key: string): number | null {
  const n = Number(get(row, key));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function strings(row: LooseRow, key: string): string[] | null {
  const v = get(row, key);
  return Array.isArray(v) && v.length <= MAX_LIST && v.every((x) => typeof x === 'string') ? [...v] : null;
}

function detail(row: LooseRow): ProfileDetail | null {
  const interests = strings(row, 'interests');
  if (!interests) return null;
  return {
    bio: str(row, 'bio') ?? '', homeArea: str(row, 'home_area') ?? '', availability: str(row, 'availability') ?? '',
    upTo: str(row, 'up_to') ?? '', interests, answers: [],
  };
}

export const mapProfileDetail = (row: LooseRow): ProfileDetail | null => detail(row);

const FOF_STATUS: readonly FofRequestStatus[] = ['none', 'pending', 'incoming', 'closed'];

export function mapFofCard(row: LooseRow): FofCard | null {
  const candidateRef = str(row, 'candidate_ref');
  const viaName = str(row, 'via_name');
  const hops = num(row, 'hops');
  const mutualCount = num(row, 'mutual_count');
  const sharedTags = strings(row, 'shared_tags');
  const requestStatus = FOF_STATUS.find((s) => s === str(row, 'request_status'));
  if (!candidateRef || !viaName || hops === null || mutualCount === null || !sharedTags || !requestStatus) return null;
  return { candidateRef, viaName, hops, mutualCount, sharedTags, requestStatus };
}

const REQUEST_STATUS: readonly NudgeRequestStatus[] = ['pending', 'accepted', 'declined', 'cancelled', 'closed'];

export function mapNudgeRequest(row: LooseRow): NudgeRequestView | null {
  const requestId = str(row, 'request_id');
  const direction = str(row, 'direction');
  const status = REQUEST_STATUS.find((s) => s === str(row, 'status'));
  const viaName = str(row, 'via_name');
  const hops = num(row, 'hops');
  const sharedTags = strings(row, 'shared_tags');
  const createdAt = str(row, 'created_at');
  if (!requestId || (direction !== 'incoming' && direction !== 'outgoing') || !status || !viaName || hops === null
    || !sharedTags || !createdAt) return null;
  return {
    requestId, direction, status, counterpartName: str(row, 'counterpart_name'), viaName, hops, sharedTags,
    message: str(row, 'message') ?? '', pairId: str(row, 'pair_id'), createdAt,
  };
}

export function mapConnectionProfile(row: LooseRow): ConnectionProfile | null {
  const base = detail(row);
  const counterpartRef = str(row, 'counterpart_ref');
  const displayName = str(row, 'display_name');
  const sharedTags = strings(row, 'shared_tags');
  if (!base || !counterpartRef || !displayName || !sharedTags) return null;
  return { ...base, counterpartRef, displayName, sharedTags };
}

export function mapAll<T>(rows: Iterable<LooseRow>, mapper: (r: LooseRow) => T | null): T[] {
  return [...rows].map(mapper).filter((x): x is T => x !== null);
}
