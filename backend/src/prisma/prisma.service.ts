import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const url = process.env.DATABASE_URL;
    console.log('[PrismaService] DATABASE_URL is set:', !!url);
    console.log('[PrismaService] DATABASE_URL length:', url?.length ?? 0);
    console.log('[PrismaService] DATABASE_URL starts with:', url?.substring(0, 15) ?? 'undefined');
    console.log('[PrismaService] NODE_ENV:', process.env.NODE_ENV);
    super();
    console.log('[PrismaService] super() succeeded');
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
