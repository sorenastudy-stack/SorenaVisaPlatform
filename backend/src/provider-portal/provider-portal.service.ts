import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateOwnProviderDto } from './dto/update-own-provider.dto';

// PR-PROVIDER-PORTAL slice B — reads and writes for the calling institution.
//
// Every method takes an ALREADY-RESOLVED providerId from the guard. None of them
// accepts one from a caller, and none should ever grow a `providerId` parameter
// sourced from a request — that is precisely how "their own data" stops meaning
// anything. The agent portal carries the same warning for the same reason.

@Injectable()
export class ProviderPortalService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The institution's own record.
   *
   * An EXPLICIT select, not a whole-row read. The model carries the commission
   * terms, the agreement dates, Sorena's internal ranking and staff `notes` —
   * returning the row and trimming it in the UI would put all of that on the
   * wire to a competitor's counterpart. What is not selected cannot leak.
   */
  async getOwn(providerId: string) {
    const provider = await this.prisma.educationProvider.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        name: true,
        legalEntityName: true,
        country: true,
        city: true,
        websiteUrl: true,
        aboutUrl: true,
        catalogueUrl: true,
        descriptionEn: true,
        status: true,
        // Counts only — never the rows. A programme list is slice C's business,
        // and these are here so the portal can say "you have 42 programmes"
        // without a second round trip.
        _count: { select: { programmes: true, tuitions: true, scholarships: true } },
      },
    });
    if (!provider) throw new NotFoundException('Institution not found.');

    const { _count, ...rest } = provider;
    return {
      ...rest,
      counts: {
        programmes: _count.programmes,
        tuitions: _count.tuitions,
        scholarships: _count.scholarships,
      },
    };
  }

  /**
   * Update the institution's own descriptive fields.
   *
   * The DTO is the allow-list and the global pipe rejects anything outside it,
   * so this method never has to defend itself against a commission field
   * arriving in `dto` — it cannot get this far.
   */
  async updateOwn(
    providerId: string,
    dto: UpdateOwnProviderDto,
    actor: { userId: string | null; name: string | null },
  ) {
    const existing = await this.prisma.educationProvider.findUnique({
      where: { id: providerId },
      select: { id: true, name: true },
    });
    if (!existing) throw new NotFoundException('Institution not found.');

    const data: Prisma.EducationProviderUpdateInput = {};
    const changedFields: string[] = [];
    for (const key of ['descriptionEn', 'websiteUrl', 'aboutUrl', 'catalogueUrl', 'city', 'legalEntityName'] as const) {
      const v = dto[key];
      if (v === undefined) continue;
      (data as Record<string, unknown>)[key] = typeof v === 'string' && v.trim() === '' ? null : v;
      changedFields.push(key);
    }
    if (changedFields.length === 0) return this.getOwn(providerId);

    await this.prisma.$transaction(async (tx) => {
      await tx.educationProvider.update({ where: { id: providerId }, data });
      // Audited as a PROVIDER-initiated change specifically: "the institution
      // edited this" is a different fact from "a staff member edited this", and
      // the actor snapshot is what makes that answerable later.
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'UPDATE',
          eventType: 'EDUCATION_PROVIDER_SELF_UPDATED',
          entityType: 'EDUCATION_PROVIDER',
          entityId: providerId,
          newValue: { providerId, changedFields } as Prisma.InputJsonValue,
          actorNameSnapshot: actor.name,
          actorRoleSnapshot: 'PROVIDER',
        },
      });
    });

    return this.getOwn(providerId);
  }
}
