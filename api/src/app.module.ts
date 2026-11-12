import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { BillingModule } from './billing/billing.module.js';
import { EdgeModule } from './edge/edge.module.js';
import { IdentityModule } from './identity/identity.module.js';
import { JournalModule } from './journal/journal.module.js';
import { LlmModule } from './llm/llm.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { WorkspaceGateModule } from './workspace-gate/workspace-gate.module.js';

// One module per PRD area (PRD 9.1).
@Module({
  imports: [
    IdentityModule,
    EdgeModule,
    WorkspaceGateModule,
    LlmModule,
    JournalModule,
    BillingModule,
    NotificationsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
