import { ForbiddenException, Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { hasRole } from '../auth/role.util';
import { LeadsService } from '../leads/leads.service';

/** Caller identity for contact scoping. Optional so internal callers are unaffected. */
export interface ContactsActor {
  id?: string | null;
  role?: string | null;
  secondaryRoles?: readonly string[] | null;
}
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateContactDto) {
    // Check for duplicate email
    const existing = await this.prisma.contact.findUnique({
      where: { email: dto.email },
    });

    if (existing && !existing.archivedAt) {
      throw new BadRequestException('A contact with this email already exists');
    }

    return this.prisma.contact.create({
      data: dto,
    });
  }

  /**
   * Contacts, scoped to the caller.
   *
   * A contact reaches a person through the leads on it — and a contact can carry
   * SEVERAL leads (production has one with eight), so this asks "is there ANY
   * lead on this contact that I own" rather than assuming a single owner. Schema
   * permits leads under different owners even though no such row exists today;
   * `some` is correct either way, where an owner field on Contact would not be.
   */
  async findAll(search?: string, actor?: ContactsActor) {
    const where: any = search
      ? {
          AND: [
            {
              OR: [
                { fullName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } },
              ],
            },
            { archivedAt: null },
          ],
        }
      : { archivedAt: null };

    if (actor && !hasRole(actor, ...LeadsService.FUNNEL_OVERSIGHT_ROLES)) {
      if (!actor.id) throw new ForbiddenException('You are not allowed to view contacts.');
      // Applied last and unconditionally: a caller-supplied search narrows, it
      // never widens who the caller may see.
      where.leads = { some: { ownerId: actor.id } };
    }

    return this.prisma.contact.findMany({
      where,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        whatsapp: true,
        countryOfResidence: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  /**
   * One contact.
   *
   * `actor` is optional so internal callers (update, archive, the intake flow)
   * keep working — they establish their own right to act. When supplied, it
   * enforces the same boundary the list does: scoping only the list would leave
   * every contact readable by id, which is the hole closed on leads earlier.
   *
   * Not-found rather than forbidden: confirming a contact exists but belongs to
   * someone else is itself a disclosure.
   */
  async findOne(id: string, actor?: ContactsActor) {
    const contact = await this.prisma.contact.findUnique({
      where: { id },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        whatsapp: true,
        countryOfResidence: true,
        archivedAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!contact || contact.archivedAt) {
      throw new NotFoundException('Contact not found');
    }

    if (actor && !hasRole(actor, ...LeadsService.FUNNEL_OVERSIGHT_ROLES)) {
      const mine = actor.id
        ? await this.prisma.lead.count({ where: { contactId: id, ownerId: actor.id } })
        : 0;
      if (mine === 0) throw new NotFoundException('Contact not found');
    }

    return contact;
  }

  async update(id: string, dto: UpdateContactDto) {
    const contact = await this.findOne(id);

    // If email is being updated, check for duplicates
    if (dto.email && dto.email !== contact.email) {
      const existing = await this.prisma.contact.findUnique({
        where: { email: dto.email },
      });
      if (existing && !existing.archivedAt) {
        throw new BadRequestException('A contact with this email already exists');
      }
    }

    return this.prisma.contact.update({
      where: { id },
      data: dto,
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        whatsapp: true,
        countryOfResidence: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async softDelete(id: string) {
    await this.findOne(id);

    return this.prisma.contact.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }
}
