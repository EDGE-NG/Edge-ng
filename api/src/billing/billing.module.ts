import { Module } from '@nestjs/common';

/**
 * Plans, subscriptions, payment webhooks and usage limits. Not part of the 3-week demo.
 *
 * PRD: Flow F12, REQ-BL-1, section 13, tables plans / subscriptions / payment_events / usage_counters (9.3), edge cases EC-B.
 * Modules talk to each other through their exported services, never through
 * each other's tables (REQ-ARC-1).
 */
@Module({})
export class BillingModule {}
