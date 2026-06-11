import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import helmet from 'helmet';

async function sweepPendingUploads() {
  const pendingDir = path.resolve(process.env.UPLOAD_DIR ?? './uploads', 'pending');
  let deleted = 0;
  try {
    const files = await fs.promises.readdir(pendingDir);
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const file of files) {
      const filePath = path.join(pendingDir, file);
      try {
        const stat = await fs.promises.stat(filePath);
        if (stat.mtimeMs < cutoff) {
          await fs.promises.unlink(filePath);
          deleted++;
        }
      } catch { /* skip files that vanish between readdir and unlink */ }
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') console.warn('Pending sweep error:', err.message);
  }
  console.log(`Pending sweep: deleted ${deleted} stale files`);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error', 'warn', 'log'],
  });

  // Trust the first proxy hop (Railway's edge). Without this, Express
  // and the @nestjs/throttler IP-tracker can't see the real client IP
  // — they read req.connection.remoteAddress (the proxy) or undefined,
  // and the throttler ends up bucketing every request as a fresh
  // "client" so per-route limits silently never fire. Calling .set()
  // on the underlying Express instance via the Http adapter is the
  // portable form that works whether or not we typed the app as
  // NestExpressApplication.
  (app.getHttpAdapter().getInstance() as { set: (key: string, value: unknown) => void })
    .set('trust proxy', 1);

  app.use(helmet());

  const extraOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').filter(s => s.trim()).map(s => s.trim());
  const allowAll = extraOrigins.includes('*');
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:3002',
    'https://app.sorenavisa.com',
    'https://ample-dream-production-1005.up.railway.app',
    ...extraOrigins.filter(s => s !== '*'),
  ];
  app.enableCors({
    origin: (origin, callback) => {
      if (allowAll || !origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'), false);
      }
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  app.useGlobalFilters(new HttpExceptionFilter());

  const port = parseInt(process.env.PORT || '3001', 10);
  await app.listen(port, '0.0.0.0');
  console.log(`Backend API running on port ${port}`);
  await sweepPendingUploads();
}

bootstrap();
