import { Module } from '@nestjs/common';

/**
 * Trades, journal entries, dashboard metrics and periodic reviews.
 *
 * PRD: 4.6, 4.7, flows F8, F9, REQ-DB-1, tables trades / journal_entries / performance_snapshots / periodic_reviews (9.3), edge cases EC-J.
 * Modules talk to each other through their exported services, never through
 * each other's tables (REQ-ARC-1).
 */
@Module({})
export class JournalModule {}
