import { Module } from '@nestjs/common';

/**
 * Notification preferences and delivery (in app, email, push).
 *
 * PRD: PR-DB5, REQ-NT-1, tables notification_preferences / notifications (9.3).
 * Modules talk to each other through their exported services, never through
 * each other's tables (REQ-ARC-1).
 */
@Module({})
export class NotificationsModule {}
