import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Access denied.');
    }

    const providedKey = authHeader.slice(7);
    const expectedKey = process.env.HANDOFF_API_KEY || '';

    if (!expectedKey || expectedKey.length < 16) {
      throw new UnauthorizedException('Service not configured.');
    }

    try {
      const provided = Buffer.from(providedKey);
      const expected = Buffer.from(expectedKey);
      if (provided.length !== expected.length) {
        throw new UnauthorizedException('Access denied.');
      }
      if (!timingSafeEqual(provided, expected)) {
        throw new UnauthorizedException('Access denied.');
      }
    } catch {
      throw new UnauthorizedException('Access denied.');
    }

    return true;
  }
}
