import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: process.env.NODE_ENV === 'production' ? ['error', 'warn'] : ['error', 'warn', 'log'],
  });

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
}

bootstrap();
