/**
 * Types shared by web/ and api/. Names and values follow the PRD
 * (section 9.3 tables and section 8.1 lifecycle states).
 * Change these only together with the backend owner (Sheyi).
 */

/** PR-CL-1: how rules are grouped. */
export const RULE_CATEGORIES = [
  'entry',
  'context',
  'confirmation',
  'invalidation',
  'risk',
  'note',
] as const;
export type RuleCategory = (typeof RULE_CATEGORIES)[number];

/** PR-CL-1: a hard gate must pass; a soft rule is shown but never blocks. */
export type RuleSeverity = 'hard_gate' | 'soft';

/** PRD 5.2: how a rule can be checked. */
export type Assessability = 'chart' | 'context_needed' | 'manual';

/** PRD 8.1: checklist version lifecycle. Approved versions are immutable (PR-CL-3). */
export type ChecklistVersionStatus = 'draft' | 'approved' | 'superseded' | 'archived';

/** PR-EV-1: each rule takes 1 to 6 evidence images. */
export const MIN_EVIDENCE_IMAGES = 1;
export const MAX_EVIDENCE_IMAGES = 6;
export type EvidencePolarity = 'valid' | 'invalid';

/** PR-TW-3: the state of one rule in the live checklist panel. */
export type RuleResult = 'pass' | 'fail' | 'inconclusive' | 'not_checked';

/** PR-GT-2: the gate's three outcomes. */
export type GateResult = 'approved' | 'denied' | 'needs_evidence';

/** PRD 9.3 gate_decisions.resolution. */
export type GateResolution =
  | 'accepted_denial'
  | 'overridden'
  | 'expired'
  | 'executed'
  | 'cancelled';

/** One checked rule, as the gate sees it. */
export interface RuleCheck {
  itemKey: string;
  severity: RuleSeverity;
  result: RuleResult;
  /** Plain-language reason shown to the trader (PR-GT-2). */
  reason?: string;
  /** The view Edge still needs, e.g. "4H chart" (PR-TW-4). */
  missingEvidence?: string;
}

/**
 * PR-GT-8: the only wording Edge uses for outcomes.
 * Never say a trade is "good" or will win.
 */
export const GATE_RESULT_LABELS: Record<GateResult, string> = {
  approved: 'Passes your checklist',
  denied: 'Fails your checklist',
  needs_evidence: 'Needs evidence',
};

/** Labels for rule states. Always show with an icon and text, never colour alone. */
export const RULE_RESULT_LABELS: Record<RuleResult, string> = {
  pass: 'Pass',
  fail: 'Fail',
  inconclusive: 'Inconclusive',
  not_checked: 'Not yet checked',
};
