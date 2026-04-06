import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
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

  async findAll(search?: string) {
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

  async findOne(id: string) {
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
