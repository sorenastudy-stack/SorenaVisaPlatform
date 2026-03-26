import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AcquisitionModule } from './acquisition/acquisition.module';
import { PrismaModule } from './prisma/prisma.module';
import { EmailModule } from './email/email.module';

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
    AcquisitionModule,
  ],
})
export class AppModule {}
