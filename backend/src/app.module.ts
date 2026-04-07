import { Module } from '@nestjs/common';
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

@Module({
  imports: [
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
  ],
})
export class AppModule {}
