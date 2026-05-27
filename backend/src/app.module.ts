import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { AcquisitionModule } from './acquisition/acquisition.module';
import { PrismaModule } from './prisma/prisma.module';
import { EmailModule } from './email/email.module';
import { AuthModule } from './auth/auth.module';
import { ContactsModule } from './contacts/contacts.module';
import { LeadsModule } from './leads/leads.module';
import { IntakeModule } from './intake/intake.module';
import { PaymentsModule } from './payments/payments.module';
import { SubscriptionsModule } from './subscriptions/subscriptions.module';
import { ProvidersModule } from './providers/providers.module';
import { AiModule } from './ai/ai.module';
import { CasesModule } from './cases/cases.module';
import { ApplicationsModule } from './applications/applications.module';
import { CommissionsModule } from './commissions/commissions.module';
import { ContractsModule } from './contracts/contracts.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PublicModule } from './public/public.module';
import { StudentsModule } from './students/students.module';
import { FilesModule } from './files/files.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { EmailHashModule } from './common/email-hash/email-hash.module';
import { StaffModule } from './staff/staff.module';
import { WixWebhooksModule } from './webhooks/wix/wix-webhooks.module';
import { LegalNotesModule } from './legal-notes/legal-notes.module';
import { CaseMessagesModule } from './case-messages/case-messages.module';
import { CaseDocumentsModule } from './case-documents/case-documents.module';
import { InzDataModule } from './inz-data/inz-data.module';
import { VisaExpiryModule } from './visa-expiry/visa-expiry.module';
import { ImmigrationOfficersModule } from './immigration-officers/immigration-officers.module';
import { ScorecardModule } from './scorecard/scorecard.module';
import { MarketingModule } from './marketing/marketing.module';
import { PlatformSettingsModule } from './platform-settings/platform-settings.module';
import { WixIntegrationModule } from './wix-integration/wix-integration.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: 60000,
        limit: 60,
      },
    ]),
    PrismaModule,
    EmailModule,
    AuthModule,
    ContactsModule,
    LeadsModule,
    IntakeModule,
    PaymentsModule,
    SubscriptionsModule,
    AcquisitionModule,
    ProvidersModule,
    AiModule,
    CasesModule,
    ApplicationsModule,
    CommissionsModule,
    ContractsModule,
    DashboardModule,
    WhatsappModule,
    NotificationsModule,
    PublicModule,
    StudentsModule,
    FilesModule,
    CryptoModule,
    EmailHashModule,
    // PR-CONSULT-1: staff roles, assignments, owner-approval queue,
    // staff CRUD. Foundation for the consultant-side UI (PR-CONSULT-2+).
    StaffModule,
    // PR-WIX-1: public lead-capture webhook posted to by Wix.
    WixWebhooksModule,
    // PR-LIA-1: LIA notes + decisions + risk overrides on CRM Cases.
    LegalNotesModule,
    // PR-LIA-4: direct LIA ↔ client messaging on CRM Cases.
    CaseMessagesModule,
    // PR-LIA-5: unified LIA view of client-uploaded documents on a
    // CRM Case, with download + internal-only review verdicts.
    CaseDocumentsModule,
    // PR-LIA-6: consolidated read-only INZ application data viewer.
    InzDataModule,
    // PR-LIA-9: daily 09:00 NZ cron + dashboard endpoint for visa
    // expiry reminders. Registers ScheduleModule.forRoot() internally.
    VisaExpiryModule,
    // PR-LIA-10: Immigration Officer module — shared profiles,
    // attributed observations, and case ↔ officer linkages.
    ImmigrationOfficersModule,
    // PR-SCORECARD-1: Readiness Assessment scoring engine +
    // lead auto-creation pipeline.
    ScorecardModule,
    // PR-SCORECARD-2: marketing channel + affiliate-agent attribution
    // (staff CRUD under /staff/marketing/*) and public short-link
    // redirector (/s/:shortCode).
    MarketingModule,
    // PR-SCORECARD-4: OWNER-editable platform settings (booking URLs,
    // webhook secrets). Mounted under /staff/platform-settings/*.
    PlatformSettingsModule,
    // PR-SCORECARD-4: Wix Automation payment webhook listener +
    // staff-side payments browser. Public webhook at
    // POST /webhooks/wix/payment (shared-secret authenticated),
    // staff CRUD at /staff/wix-payments/*.
    WixIntegrationModule,
  ],
})
export class AppModule {}
