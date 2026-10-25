import type { DisclosureReceipt, RecipientPresetAssignment, RelationshipPreset } from '@dor/contracts';
import type {
  Unreadable, IntroductionSuggestionRequestView, ActivityApprovalRow, CatalogueEventView, CataloguePlaceView, CatalogueStatusView, DiscoveryCardRow, EventCompanionRow, EventIntentRow, IntroductionProposalView, PlanView, IntroductionView, UnreadableRow, InviteView, MyDiscoveryView, NudgeDeliveryView, PairView, RecipientNudgeView, RecipientPause, SignalView, SupportPreferencesView, StandingConsentView,
} from '@/lib/backend/ports';
import type { NetworkData } from '../network/types.ts';
import { EMPTY_NETWORK } from '../network/types.ts';
import { mapAll, mapConnectionProfile, mapFofCard, mapNudgeRequest, mapProfileDetail } from '../network/mappers.ts';
import type { LooseConnection, LooseRow, LooseTable } from './bindings';
import { findTable } from './names.ts';
import {
  mapAccount, mapAssignment, mapInvite, mapNudge, mapNudgeDelivery, mapPair, mapRecipientPause, mapPreset, mapReceipt, mapRows,
  mapActivityApproval, mapCatalogueEvent, mapCataloguePlace, mapCatalogueStatus, mapCompanion, mapDiscoveryCard, mapEventIntent, mapIntroduction,
  mapIntroductionProposal, mapSuggestionRequest, mapPlan, unreadableRow, mapMyDiscovery, mapSignal, mapSupportPreferences, mapStandingConsent,
} from './mappers.ts';

/** Caller-filtered views (module defines them; all base tables are private). */
export const VIEW_NAMES = [
  'my_account', 'my_pairs', 'my_invites', 'my_presets', 'my_preset_assignments', 'my_nudges', 'my_receipts',
  'my_signals', 'my_support_preferences', 'my_nudge_delivery', 'my_recipient_pauses', 'my_standing_consents',
  'my_discovery_profile', 'discovery_cards', 'my_introductions', 'my_introduction_proposals',
  'my_introduction_suggestion_request',
  'catalogue_events', 'catalogue_places', 'catalogue_status', 'my_event_intents', 'event_companions', 'my_activity_approvals', 'my_plans',
  'my_profile_detail', 'fof_cards', 'my_nudge_requests', 'my_connection_profiles',
] as const;

export type ViewName = (typeof VIEW_NAMES)[number];

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
  readonly suggestionRequest: IntroductionSuggestionRequestView | null;
  readonly catalogue: CatalogueEventView[];
  readonly places: CataloguePlaceView[];
  readonly catalogueStatus: CatalogueStatusView[];
  readonly eventIntents: EventIntentRow[];
  readonly companions: EventCompanionRow[];
  readonly activityApprovals: ActivityApprovalRow[];
  readonly plans: PlanView[];
  readonly network: NetworkData;
  readonly unreadable: Unreadable;
}

export const EMPTY_VIEWS: ViewData = {
  account: null, pairs: [], invites: [], presets: [], assignments: [], nudges: [], receipts: [], signals: [], supportPreferences: [], nudgeDelivery: [], pauses: [], standingConsents: [],
  discoveryProfile: null, discoveryCards: [], introductions: [], proposals: [], suggestionRequest: null,
  catalogue: [], places: [], catalogueStatus: [], eventIntents: [], companions: [], activityApprovals: [], plans: [], network: EMPTY_NETWORK,
  unreadable: { signals: [], supportPreferences: [], nudgeDelivery: [], presets: [], counts: {} },
};

export function viewTables(conn: LooseConnection): LooseTable[] {
  return VIEW_NAMES.flatMap((n) => findTable(conn, n) ?? []);
}

export function readViews(conn: LooseConnection): ViewData {
  const rows = (name: ViewName) => [...(findTable(conn, name)?.iter() ?? [])];
  // Every refused row is counted per view (names and counts only, never row contents), so a row that fails
  // validation shows up as a diagnostic instead of silently disappearing.
  const counts: Partial<Record<ViewName, number>> = {};
  const rejected: Partial<Record<ViewName, LooseRow[]>> = {};
  const take = <T>(name: ViewName, mapper: (r: LooseRow) => T | null): T[] => {
    const out: T[] = [];
    for (const r of rows(name)) {
      const m = mapper(r);
      if (m) out.push(m);
      else (rejected[name] ??= []).push(r);
    }
    if (rejected[name]) counts[name] = rejected[name].length;
    return out;
  };
  /** Rows the mapper refused, identified only by their own primary key and pair (both the caller's own data). */
  const refused = (name: ViewName, idKey: string): UnreadableRow[] => (rejected[name] ?? []).map((r) => unreadableRow(r, idKey));
  const account = take('my_account', mapAccount)[0] ?? null;
  const data = {
    account,
    pairs: take('my_pairs', mapPair),
    invites: take('my_invites', mapInvite),
    presets: take('my_presets', mapPreset),
    assignments: take('my_preset_assignments', mapAssignment),
    nudges: take('my_nudges', mapNudge),
    receipts: take('my_receipts', mapReceipt),
    signals: take('my_signals', mapSignal),
    proposals: take('my_introduction_proposals', mapIntroductionProposal),
    suggestionRequest: take('my_introduction_suggestion_request', mapSuggestionRequest)[0] ?? null,
    catalogue: take('catalogue_events', mapCatalogueEvent),
    places: take('catalogue_places', mapCataloguePlace),
    catalogueStatus: take('catalogue_status', mapCatalogueStatus),
    eventIntents: take('my_event_intents', mapEventIntent),
    companions: take('event_companions', mapCompanion),
    activityApprovals: take('my_activity_approvals', mapActivityApproval),
    plans: take('my_plans', mapPlan),
    supportPreferences: take('my_support_preferences', mapSupportPreferences),
    nudgeDelivery: take('my_nudge_delivery', mapNudgeDelivery),
    pauses: take('my_recipient_pauses', mapRecipientPause),
    standingConsents: take('my_standing_consents', mapStandingConsent),
    discoveryProfile: take('my_discovery_profile', mapMyDiscovery)[0] ?? null,
    discoveryCards: take('discovery_cards', mapDiscoveryCard),
    introductions: take('my_introductions', mapIntroduction),
  };
  return {
    ...data,
    network: {
      profile: mapAll(rows('my_profile_detail'), mapProfileDetail)[0] ?? null,
      fofCards: mapAll(rows('fof_cards'), mapFofCard),
      requests: mapAll(rows('my_nudge_requests'), mapNudgeRequest),
      connections: mapAll(rows('my_connection_profiles'), mapConnectionProfile),
    },
    unreadable: {
      signals: refused('my_signals', 'signal_id'),
      supportPreferences: refused('my_support_preferences', 'consent_id'),
      nudgeDelivery: refused('my_nudge_delivery', 'delivery_id'),
      presets: refused('my_presets', 'policy_id'),
      counts,
    },
  };
}
