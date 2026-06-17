import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Client portal step 2 — service for the signed-in client's OWN case.
//
// Identity flows: JWT → req.user.userId → (this service) → Prisma WHERE
// clause `lead.contact.userId = <caller>`. The caller never supplies a
// case id, so cross-tenant access is impossible at the query layer
// (not relying on access checks downstream — the filter IS the gate).
//
// The response shape is built by explicit field picking, not spread.
// Forbidden fields (notes, riskLevel, raw FK ids, INZ internal-only
// columns, etc.) cannot leak through a future schema addition because
// the picker won't surface them.

@Injectable()
export class PortalService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyCase(userId: string) {
    const c = await this.prisma.case.findFirst({
      where:   { lead: { contact: { userId } } },
      orderBy: { createdAt: 'desc' },
      include: {
        lia:     { select: { name: true } },
        owner:   { select: { name: true } },
        support: { select: { name: true } },
        finance: { select: { name: true } },
      },
    });
    if (!c) {
      throw new NotFoundException(
        "We couldn't find a case for your account yet. If you think this is a mistake, contact support.",
      );
    }

    // Explicit field picking — DO NOT spread. Every key here is on the
    // documented client-safe whitelist. The relation includes are
    // mapped to {name} only — the staff user's id, role, email, etc.
    // are dropped on the floor.
    return {
      id:                   c.id,
      stage:                c.stage,
      status:               c.status,
      createdAt:            c.createdAt,
      updatedAt:            c.updatedAt,
      assignedLia:          c.lia     ? { name: c.lia.name }     : null,
      assignedConsultant:   c.owner   ? { name: c.owner.name }   : null,
      assignedSupport:      c.support ? { name: c.support.name } : null,
      assignedFinance:      c.finance ? { name: c.finance.name } : null,
      inzApplicationNumber: c.inzApplicationNumber,
      inzSubmittedAt:       c.inzSubmittedAt,
    };
  }
}
