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
  ],
})
export class AppModule {}
