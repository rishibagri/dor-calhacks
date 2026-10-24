import type { DisclosureReceipt, Nudge, RecipientPresetAssignment, RelationshipPreset } from '@dor/contracts';
import type { InviteView, PairView } from '@/lib/backend/ports';
import { findTable, type LooseConnection, type LooseTable } from './bindings';
import {
  mapAccount, mapAssignment, mapInvite, mapNudge, mapPair, mapPreset, mapReceipt, mapRows,
} from './mappers';

/** Caller-filtered views (module defines them; all base tables are private). */
export const VIEW_NAMES = [
  'my_account', 'my_pairs', 'my_invites', 'my_presets', 'my_preset_assignments', 'my_nudges', 'my_receipts',
] as const;

export interface ViewData {
  readonly account: { displayName: string } | null;
  readonly pairs: PairView[];
  readonly invites: InviteView[];
  readonly presets: RelationshipPreset[];
  readonly assignments: RecipientPresetAssignment[];
  readonly nudges: Nudge[];
  readonly receipts: DisclosureReceipt[];
}

export const EMPTY_VIEWS: ViewData = {
  account: null, pairs: [], invites: [], presets: [], assignments: [], nudges: [], receipts: [],
};

export function viewTables(conn: LooseConnection): LooseTable[] {
  return VIEW_NAMES.flatMap((n) => findTable(conn, n) ?? []);
}

export function readViews(conn: LooseConnection): ViewData {
  const rows = (name: (typeof VIEW_NAMES)[number]) => findTable(conn, name)?.iter() ?? [];
  const accountRow = [...rows('my_account')][0];
  return {
    account: accountRow ? mapAccount(accountRow) : null,
    pairs: mapRows(rows('my_pairs'), mapPair),
    invites: mapRows(rows('my_invites'), mapInvite),
    presets: mapRows(rows('my_presets'), mapPreset),
    assignments: mapRows(rows('my_preset_assignments'), mapAssignment),
    nudges: mapRows(rows('my_nudges'), mapNudge),
    receipts: mapRows(rows('my_receipts'), mapReceipt),
  };
}
