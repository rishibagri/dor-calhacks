/**
 * Talking points (D056 as amended by D058): the friend's nudge may carry one generic conversation starter, chosen from
 * this fixed list. The model picks an id; the device sends the id; `attach_signal_hook` accepts only listed ids; the
 * recipient's app shows the fixed text. Nothing in a talking point comes from the journal: no topic, event, feeling or
 * name. Runtime-dependency-free so the SpacetimeDB module enforces the same list (re-exported from
 * `@dor/contracts/policy`).
 */
export const TALKING_POINTS = {
  ask_week: 'Ask how their week is going.',
  ask_lately: 'Ask what they’ve been up to lately.',
  ask_new: 'Ask what’s new with them.',
  catch_up: 'Suggest catching up soon.',
  coffee: 'Suggest grabbing coffee or a meal.',
  walk: 'Suggest a walk or something low-key.',
  offer_hand: 'Ask if there’s anything you can help with.',
  say_hi: 'Just say hi.',
} as const;

export type TalkingPointId = keyof typeof TALKING_POINTS;
export const TALKING_POINT_IDS = Object.keys(TALKING_POINTS) as TalkingPointId[];

export const isTalkingPointId = (v: unknown): v is TalkingPointId =>
  typeof v === 'string' && Object.prototype.hasOwnProperty.call(TALKING_POINTS, v);

/** The fixed text for a stored id, or null for anything else (old free-text rows included). */
export const talkingPointText = (v: unknown): string | null => (isTalkingPointId(v) ? TALKING_POINTS[v] : null);
