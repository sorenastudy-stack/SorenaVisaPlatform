import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MeetingsController } from './meetings.controller';
import { MeetingsConsultantController } from './meetings.consultant.controller';
import { BookingConfigController } from './booking-config.controller';
import { MeetingsService } from './meetings.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { CryptoModule } from '../../common/crypto/crypto.module';

// PR-DASH-3 — Meetings module.
//
// Three controllers under one service:
//   * MeetingsController            → /api/student/meetings/*
//   * MeetingsConsultantController  → /api/consultant/meetings/*
//   * BookingConfigController       → /api/student/booking-config
//
// Exports MeetingsService so DashboardModule can include an upcoming-
// meeting summary block in its payload without duplicating the
// ownership logic.
@Module({
  imports: [PrismaModule, CryptoModule, ConfigModule],
  controllers: [
    MeetingsController,
    MeetingsConsultantController,
    BookingConfigController,
  ],
  providers: [MeetingsService],
  exports:   [MeetingsService],
})
export class MeetingsModule {}
