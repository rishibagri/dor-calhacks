import type { DisclosureReceipt, RecipientPresetAssignment, RelationshipPreset } from '@dor/contracts';
import type {
  ActivityApprovalRow, CatalogueEventView, CatalogueStatusView, DiscoveryCardRow, EventCompanionRow, EventIntentRow, IntroductionProposalView, PlanView, IntroductionView, UnreadableRow, InviteView, MyDiscoveryView, NudgeDeliveryView, PairView, RecipientNudgeView, RecipientPause, SignalView, SupportPreferencesView, StandingConsentView,
} from '@/lib/backend/ports';
import { findTable, type LooseConnection, type LooseRow, type LooseTable } from './bindings';
import {
  mapAccount, mapAssignment, mapInvite, mapNudge, mapNudgeDelivery, mapPair, mapRecipientPause, mapPreset, mapReceipt, mapRows,
  mapActivityApproval, mapCatalogueEvent, mapCatalogueStatus, mapCompanion, mapDiscoveryCard, mapEventIntent, mapIntroduction,
  mapIntroductionProposal, mapPlan, unreadableRow, mapMyDiscovery, mapSignal, mapSupportPreferences, mapStandingConsent,
} from './mappers';

/** Caller-filtered views (module defines them; all base tables are private). */
export const VIEW_NAMES = [
  'my_account', 'my_pairs', 'my_invites', 'my_presets', 'my_preset_assignments', 'my_nudges', 'my_receipts',
  'my_signals', 'my_support_preferences', 'my_nudge_delivery', 'my_recipient_pauses', 'my_standing_consents',
  'my_discovery_profile', 'discovery_cards', 'my_introductions', 'my_introduction_proposals',
  'catalogue_events', 'catalogue_status', 'my_event_intents', 'event_companions', 'my_activity_approvals', 'my_plans',
] as const;

export interface ViewData {
  readonly account: { displayName: string } | null;
  readonly pairs: PairView[];
  readonly invites: InviteView[];
  readonly presets: RelationshipPreset[];
  readonly assignments: RecipientPresetAssignment[];
  readonly nudges: RecipientNudgeView[];
  readonly receipts: DisclosureReceipt[];
  readonly signals: SignalView[];
  readonly supportPreferences: SupportPreferencesView[];
  readonly nudgeDelivery: NudgeDeliveryView[];
  readonly pauses: RecipientPause[];
  readonly standingConsents: StandingConsentView[];
  readonly discoveryProfile: MyDiscoveryView | null;
  readonly discoveryCards: DiscoveryCardRow[];
  readonly introductions: IntroductionView[];
  readonly proposals: IntroductionProposalView[];
  readonly catalogue: CatalogueEventView[];
  readonly catalogueStatus: CatalogueStatusView[];
  readonly eventIntents: EventIntentRow[];
  readonly companions: EventCompanionRow[];
  readonly activityApprovals: ActivityApprovalRow[];
  readonly plans: PlanView[];
  readonly unreadable: { signals: UnreadableRow[]; supportPreferences: UnreadableRow[]; nudgeDelivery: UnreadableRow[] };
}

export const EMPTY_VIEWS: ViewData = {
  account: null, pairs: [], invites: [], presets: [], assignments: [], nudges: [], receipts: [], signals: [], supportPreferences: [], nudgeDelivery: [], pauses: [], standingConsents: [],
  discoveryProfile: null, discoveryCards: [], introductions: [], proposals: [],
  catalogue: [], catalogueStatus: [], eventIntents: [], companions: [], activityApprovals: [], plans: [],
  unreadable: { signals: [], supportPreferences: [], nudgeDelivery: [] },
};

export function viewTables(conn: LooseConnection): LooseTable[] {
  return VIEW_NAMES.flatMap((n) => findTable(conn, n) ?? []);
}

/** Rows the mapper refused, identified only by their own primary key and pair (both the caller's own data). */
function rejectedRows<T>(rows: Iterable<LooseRow>, mapper: (r: LooseRow) => T | null, idKey: string): UnreadableRow[] {
  return [...rows].filter((r) => mapper(r) === null).map((r) => unreadableRow(r, idKey));
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
    signals: mapRows(rows('my_signals'), mapSignal),
    proposals: mapRows(rows('my_introduction_proposals'), mapIntroductionProposal),
    catalogue: mapRows(rows('catalogue_events'), mapCatalogueEvent),
    catalogueStatus: mapRows(rows('catalogue_status'), mapCatalogueStatus),
    eventIntents: mapRows(rows('my_event_intents'), mapEventIntent),
    companions: mapRows(rows('event_companions'), mapCompanion),
    activityApprovals: mapRows(rows('my_activity_approvals'), mapActivityApproval),
    plans: mapRows(rows('my_plans'), mapPlan),
    unreadable: {
      signals: rejectedRows(rows('my_signals'), mapSignal, 'signal_id'),
      supportPreferences: rejectedRows(rows('my_support_preferences'), mapSupportPreferences, 'consent_id'),
      nudgeDelivery: rejectedRows(rows('my_nudge_delivery'), mapNudgeDelivery, 'delivery_id'),
    },
    supportPreferences: mapRows(rows('my_support_preferences'), mapSupportPreferences),
    nudgeDelivery: mapRows(rows('my_nudge_delivery'), mapNudgeDelivery),
    pauses: mapRows(rows('my_recipient_pauses'), mapRecipientPause),
    standingConsents: mapRows(rows('my_standing_consents'), mapStandingConsent),
    discoveryProfile: mapRows(rows('my_discovery_profile'), mapMyDiscovery)[0] ?? null,
    discoveryCards: mapRows(rows('discovery_cards'), mapDiscoveryCard),
    introductions: mapRows(rows('my_introductions'), mapIntroduction),
  };
}
