import type { RuleCheck } from '@edge/shared';
import { rollUpGate } from './decision-engine.js';

const hard = (itemKey: string, result: RuleCheck['result']): RuleCheck => ({
  itemKey,
  severity: 'hard_gate',
  result,
});
const soft = (itemKey: string, result: RuleCheck['result']): RuleCheck => ({
  itemKey,
  severity: 'soft',
  result,
});

describe('rollUpGate (REQ-GT-1)', () => {
  it('approves when every hard gate passes', () => {
    const rollup = rollUpGate([hard('trend', 'pass'), hard('stop', 'pass')]);
    expect(rollup.result).toBe('approved');
  });

  it('denies when any hard gate fails, even if many soft rules pass (EC-G2)', () => {
    const rollup = rollUpGate([
      hard('news', 'fail'),
      soft('a', 'pass'),
      soft('b', 'pass'),
      soft('c', 'pass'),
    ]);
    expect(rollup.result).toBe('denied');
    expect(rollup.failedRules.map((r) => r.itemKey)).toEqual(['news']);
  });

  it('needs evidence when a hard gate is inconclusive (EC-G3)', () => {
    const rollup = rollUpGate([hard('trend', 'pass'), hard('confirmation', 'inconclusive')]);
    expect(rollup.result).toBe('needs_evidence');
    expect(rollup.unresolvedRules.map((r) => r.itemKey)).toEqual(['confirmation']);
  });

  it('needs evidence when a hard gate is not yet checked (EC-G1)', () => {
    expect(rollUpGate([hard('trend', 'not_checked')]).result).toBe('needs_evidence');
  });

  it('a failed hard gate wins over an unresolved one', () => {
    expect(rollUpGate([hard('a', 'inconclusive'), hard('b', 'fail')]).result).toBe('denied');
  });

  it('soft rules never block, even when they fail', () => {
    expect(rollUpGate([hard('trend', 'pass'), soft('volume', 'fail')]).result).toBe('approved');
  });
});
