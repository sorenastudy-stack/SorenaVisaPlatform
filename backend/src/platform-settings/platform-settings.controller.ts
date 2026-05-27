import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { PlatformSettingsService } from './platform-settings.service';
import { UpdateSettingDto } from './dto/platform-settings.dto';

// PR-SCORECARD-4 — Platform-settings endpoints.
//
// Mounted under /staff/platform-settings/*. Locked to OWNER and
// SUPER_ADMIN only — even ADMIN cannot edit these. The booking URLs
// drive every scorecard CTA and the Wix webhook secret is the only
// thing standing between an attacker and the payment-log table, so
// the role gate is deliberately tight.
//
// All routes use req.user?.userId ?? req.user?.id per d95640d.

@Controller('staff/platform-settings')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PlatformSettingsController {
  constructor(private readonly service: PlatformSettingsService) {}

  @Get()
  @Roles('OWNER', 'SUPER_ADMIN')
  list(@Query('category') category?: string) {
    return this.service.list(category);
  }

  @Get(':key')
  @Roles('OWNER', 'SUPER_ADMIN')
  detail(@Param('key') key: string) {
    return this.service.get(key);
  }

  @Patch(':key')
  @Roles('OWNER', 'SUPER_ADMIN')
  update(
    @Param('key') key: string,
    @Body() dto: UpdateSettingDto,
    @Req() req: any,
  ) {
    return this.service.update(key, dto.value, this.actor(req));
  }

  @Post('wix-webhook-secret/regenerate')
  @Roles('OWNER', 'SUPER_ADMIN')
  regenerateSecret(@Req() req: any) {
    return this.service.regenerateWebhookSecret(this.actor(req));
  }

  private actor(req: any) {
    return {
      id: req.user?.userId ?? req.user?.id,
      name: req.user?.name ?? null,
      role: req.user?.role ?? null,
    };
  }
}
