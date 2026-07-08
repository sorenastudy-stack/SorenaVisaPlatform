import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AcquisitionModule } from './acquisition/acquisition.module';
import { PrismaModule } from './prisma/prisma.module';
import { EmailModule } from './email/email.module';
import { MailModule } from './mail/mail.module';
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
import { DocumentsModule } from './documents/documents.module';
import { PortalModule } from './portal/portal.module';
import { DigestModule } from './digest/digest.module';
import { InzDataModule } from './inz-data/inz-data.module';
import { VisaExpiryModule } from './visa-expiry/visa-expiry.module';
import { ImmigrationOfficersModule } from './immigration-officers/immigration-officers.module';
import { ScorecardModule } from './scorecard/scorecard.module';
import { MarketingModule } from './marketing/marketing.module';
import { PlatformSettingsModule } from './platform-settings/platform-settings.module';
import { BookingModule } from './booking/booking.module';
import { WalletModule } from './wallet/wallet.module';

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
    // PR-EMAIL-1 — unified Resend-based mail. @Global, so available
    // app-wide without re-importing. Coexists with EmailModule +
    // NotificationsModule until call sites are repointed.
    MailModule,
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
    // Client portal step 2: client-only /portal/* surface, gated to
    // roles LEAD + STUDENT. Single endpoint today (GET /portal/me/case).
    PortalModule,
    // Phase 8: weekly client digest, data-gathering layer only. No
    // consumers yet — cron + email composer land in later prompts.
    DigestModule,
    // Documents step 3: R2-backed case attachments (System A). Owns
    // GET :caseId/documents. No longer collides with CaseDocumentsModule
    // below (its list route was renamed to :caseId/document-reviews).
    DocumentsModule,
    // PR-LIA-5: unified review view of client-uploaded documents on a CRM
    // Case (admission/application/visa-supporting source tables), with
    // download + internal-only review verdicts. List route is
    // GET :caseId/document-reviews (distinct from System A). Also hosts the
    // OPS cross-case unreviewed queue (GET /ops/documents/unreviewed).
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
    // PR-BOOKING-3: native in-portal booking. Stage 3 = FREE_15 flow
    // (GET /booking/slots, POST /booking/confirm, GET /booking/mine),
    // gated to LEAD/STUDENT.
    BookingModule,
    // PR-WALLET slice 1: client store-credit wallet + ledger (GET /wallet)
    // and proof-of-acceptance capture used by the paid-booking checkout.
    WalletModule,
  ],
  providers: [
    // Apply the ThrottlerModule baseline (60/min/IP from `default`
    // throttler above) to every route in the app. Routes that need
    // a tighter limit override with `@Throttle({ default: { …} })`;
    // routes that must NOT be throttled (webhooks, healthchecks,
    // OAuth round-trips) opt out with `@SkipThrottle()`.
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
