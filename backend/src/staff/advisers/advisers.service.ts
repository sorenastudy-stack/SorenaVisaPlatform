import {
  Injectable, NotFoundException, BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  UpdateAdviserProfileDto, AvailabilityWindowDto,
} from './dto/advisers.dto';

// PR-BOOKING-ADMIN-A — adviser management service.
//
// Configures EXISTING staff users (role LIA or CONSULTANT) for booking:
// languages, canonical timezone, which session types they handle, an
// on/off toggle, and their weekly availability windows. It does not
// create users — that's /staff/users.

// Adviser-eligible roles.
const ADVISER_ROLES = ['LIA', 'CONSULTANT'] as const;

@Injectable()
export class AdvisersService {
  constructor(private readonly prisma: PrismaService) {}

  /** List adviser-eligible users with booking config + availability summary. */
  async list() {
    const users = await this.prisma.user.findMany({
      where: { role: { in: [...ADVISER_ROLES] } },
      orderBy: { name: 'asc' },
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        languages: true, timezone: true, bookableSessionTypes: true, bookingActive: true,
        liaProfile: { select: { iaaLicenceVerifiedAt: true } },
        _count: { select: { adviserAvailability: { where: { active: true } } } },
      },
    });

    return users.map((u) => {
      const windowCount = u._count.adviserAvailability;
      const liaVerified = !!u.liaProfile?.iaaLicenceVerifiedAt;
      const hasTypes = u.bookableSessionTypes.length > 0;
      // Derived: bookable if active toggle on, has at least one type, and
      // has availability. (Per-type LIA verification is enforced at the
      // engine + on save; the list "bookable" is the coarse signal.)
      const bookable = u.bookingActive && hasTypes && windowCount > 0;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        liaVerified,
        languages: u.languages,
        timezone: u.timezone,
        bookableSessionTypes: u.bookableSessionTypes,
        bookingActive: u.bookingActive,
        windowCount,
        availabilitySet: windowCount > 0,
        bookable,
      };
    });
  }

  /** One adviser's full config: profile + weekly windows + LIA status. */
  async getOne(id: string) {
    const u = await this.prisma.user.findFirst({
      where: { id, role: { in: [...ADVISER_ROLES] } },
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        languages: true, timezone: true, bookableSessionTypes: true, bookingActive: true,
        liaProfile: { select: { iaaLicenceVerifiedAt: true } },
        adviserAvailability: {
          where: { active: true },
          orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }],
          select: { id: true, dayOfWeek: true, startMinute: true, endMinute: true, timezone: true },
        },
      },
    });
    if (!u) throw new NotFoundException('Adviser not found');

    return {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      liaVerified: !!u.liaProfile?.iaaLicenceVerifiedAt,
      languages: u.languages,
      timezone: u.timezone,
      bookableSessionTypes: u.bookableSessionTypes,
      bookingActive: u.bookingActive,
      windows: u.adviserAvailability,
    };
  }

  /**
   * Update booking profile (languages / timezone / types / active).
   * LIA may only be a bookable type for a verified-LIA user. Setting the
   * timezone propagates into the adviser's availability rows so the slot
   * engine (which reads the row timezone) stays consistent.
   */
  async updateProfile(id: string, dto: UpdateAdviserProfileDto) {
    const u = await this.prisma.user.findFirst({
      where: { id, role: { in: [...ADVISER_ROLES] } },
      select: { id: true, role: true, liaProfile: { select: { iaaLicenceVerifiedAt: true } } },
    });
    if (!u) throw new NotFoundException('Adviser not found');

    if (dto.bookableSessionTypes?.includes('LIA')) {
      const verified = u.role === 'LIA' && !!u.liaProfile?.iaaLicenceVerifiedAt;
      if (!verified) {
        throw new BadRequestException('Only a verified LIA adviser can offer LIA sessions');
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: {
          ...(dto.languages !== undefined ? { languages: dto.languages } : {}),
          ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
          ...(dto.bookableSessionTypes !== undefined ? { bookableSessionTypes: dto.bookableSessionTypes } : {}),
          ...(dto.bookingActive !== undefined ? { bookingActive: dto.bookingActive } : {}),
        },
      });
      // Mirror the canonical timezone into the adviser's availability rows.
      if (dto.timezone !== undefined) {
        await tx.adviserAvailability.updateMany({
          where: { adviserId: id },
          data: { timezone: dto.timezone },
        });
      }
    });

    return this.getOne(id);
  }

  /**
   * Replace the adviser's full weekly window set. Validates each window
   * (start < end) and that windows don't overlap within a day, then
   * deletes the existing active rows and recreates them — stamped with
   * the adviser's canonical timezone.
   */
  async replaceAvailability(id: string, windows: AvailabilityWindowDto[]) {
    const u = await this.prisma.user.findFirst({
      where: { id, role: { in: [...ADVISER_ROLES] } },
      select: { id: true, timezone: true },
    });
    if (!u) throw new NotFoundException('Adviser not found');

    // Per-window: start < end.
    for (const w of windows) {
      if (w.startMinute >= w.endMinute) {
        throw new BadRequestException(
          `Invalid window on day ${w.dayOfWeek}: start must be before end`,
        );
      }
    }
    // No overlaps within the same weekday (end-exclusive).
    const byDay = new Map<number, AvailabilityWindowDto[]>();
    for (const w of windows) {
      const list = byDay.get(w.dayOfWeek) ?? [];
      list.push(w);
      byDay.set(w.dayOfWeek, list);
    }
    for (const [day, list] of byDay) {
      const sorted = [...list].sort((a, b) => a.startMinute - b.startMinute);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].startMinute < sorted[i - 1].endMinute) {
          throw new BadRequestException(`Overlapping windows on day ${day}`);
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.adviserAvailability.deleteMany({ where: { adviserId: id } });
      if (windows.length > 0) {
        await tx.adviserAvailability.createMany({
          data: windows.map((w) => ({
            adviserId: id,
            dayOfWeek: w.dayOfWeek,
            startMinute: w.startMinute,
            endMinute: w.endMinute,
            timezone: u.timezone,
            active: true,
          })),
        });
      }
    });

    return this.getOne(id);
  }
}
