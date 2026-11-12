import { Module } from '@nestjs/common';

/**
 * Trade workspace sessions, chart frames, rule checks, trade intents, gate decisions and overrides.
 *
 * PRD: 4.4, 4.5, flows F5 to F7, REQ-GT-1 to REQ-GT-8, tables workspace_sessions / chart_frames / rule_checks / trade_intents / gate_decisions / overrides (9.3), edge cases EC-C, EC-G.
 * Modules talk to each other through their exported services, never through
 * each other's tables (REQ-ARC-1).
 */
@Module({})
export class WorkspaceGateModule {}
