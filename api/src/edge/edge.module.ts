import { Module } from '@nestjs/common';

/**
 * Chats, checklists and versions, rules, evidence images and rule cards.
 *
 * PRD: 4.1 to 4.3, flows F2 to F4, tables chats / checklists / checklist_versions / checklist_items / evidence_images / rule_cards (9.3), REQ-DT-1, edge cases EC-P, EC-V.
 * Modules talk to each other through their exported services, never through
 * each other's tables (REQ-ARC-1).
 */
@Module({})
export class EdgeModule {}
