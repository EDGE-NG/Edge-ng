import type { GateResult, RuleCheck } from '@edge/shared';

export interface GateRollup {
  result: GateResult;
  /** Hard-gate rules that failed. Shown first in the explanation (EC-G2). */
  failedRules: RuleCheck[];
  /** Hard-gate rules that are Inconclusive or not yet checked (EC-G1, EC-G3). */
  unresolvedRules: RuleCheck[];
}

/**
 * Hard-gate roll-up (REQ-GT-1, PR-GT-7). Plain code, never model judgment:
 *
 * - any hard-gate Fail                      -> denied
 * - else any hard-gate Inconclusive/unchecked -> needs_evidence
 * - else                                    -> approved
 *
 * Soft rules never offset a hard gate, so they do not change the result.
 * Risk rules (stop, max risk, min risk-to-reward) arrive here already
 * evaluated in code from the ticket values (PR-GT-3), as hard-gate checks.
 */
export function rollUpGate(checks: readonly RuleCheck[]): GateRollup {
  const hardGates = checks.filter((check) => check.severity === 'hard_gate');

  const failedRules = hardGates.filter((check) => check.result === 'fail');
  const unresolvedRules = hardGates.filter(
    (check) => check.result === 'inconclusive' || check.result === 'not_checked',
  );

  let result: GateResult = 'approved';
  if (failedRules.length > 0) {
    result = 'denied';
  } else if (unresolvedRules.length > 0) {
    result = 'needs_evidence';
  }

  return { result, failedRules, unresolvedRules };
}
