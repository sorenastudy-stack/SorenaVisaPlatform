import { Controller, Get, Post, Body, Patch, Delete, Param, Query, UseGuards } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

// Contacts are CRM PII (name/email/phone/whatsapp/country) underlying the lead
// funnel. Was JwtAuthGuard-only → any authenticated user (incl. self-registered
// clients) could list/read/edit/delete every contact. Gated to the CRM funnel
// roles; deletion is admin-only. RolesGuard is now class-wide, so every route
// needs an explicit @Roles (no-@Roles would be allow-all).
const CRM_ROLES = ['OWNER', 'SUPER_ADMIN', 'ADMIN', 'CONSULTANT', 'FINANCE'] as const;
const CRM_ADMIN = ['OWNER', 'SUPER_ADMIN', 'ADMIN'] as const;

@Controller('contacts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContactsController {
  constructor(private contactsService: ContactsService) {}

  @Post()
  @Roles(...CRM_ROLES)
  create(@Body() dto: CreateContactDto) {
    return this.contactsService.create(dto);
  }

  @Get()
  @Roles(...CRM_ROLES)
  findAll(@Query('search') search?: string) {
    return this.contactsService.findAll(search);
  }

  @Get(':id')
  @Roles(...CRM_ROLES)
  findOne(@Param('id') id: string) {
    return this.contactsService.findOne(id);
  }

  @Patch(':id')
  @Roles(...CRM_ROLES)
  update(@Param('id') id: string, @Body() dto: UpdateContactDto) {
    return this.contactsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(...CRM_ADMIN)
  softDelete(@Param('id') id: string) {
    return this.contactsService.softDelete(id);
  }
}
