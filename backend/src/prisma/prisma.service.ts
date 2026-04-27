import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger: Logger;

  constructor() {
    const url = process.env.DATABASE_URL;
    console.log('[PrismaService] DATABASE_URL is set:', !!url);
    console.log('[PrismaService] DATABASE_URL length:', url?.length ?? 0);
    console.log('[PrismaService] DATABASE_URL starts with:', url?.substring(0, 20) ?? 'undefined');
    console.log('[PrismaService] NODE_ENV:', process.env.NODE_ENV);
    try {
      super();
      this.logger = new Logger(PrismaService.name);
      console.log('[PrismaService] super() succeeded');
    } catch (err: any) {
      console.error('[PrismaService] super() FAILED:', err?.message);
      console.error('[PrismaService] super() stack:', err?.stack);
      throw err;
    }
  }

  async onModuleInit() {
    try {
      await this.$connect();
      this.logger.log('Database connected');
    } catch (err: any) {
      console.error('[PrismaService] $connect() FAILED:', err?.message);
      throw err;
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
