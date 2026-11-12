import { Module } from '@nestjs/common';

/**
 * Sign-up, sign-in, sessions, MFA, settings, disclaimer acceptance.
 *
 * PRD: Flow F1, 4.8, REQ-ID-1, tables users / user_settings / auth_sessions / legal_acceptances (9.3), edge cases EC-A.
 * Modules talk to each other through their exported services, never through
 * each other's tables (REQ-ARC-1).
 */
@Module({})
export class IdentityModule {}
