import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { validateEmploymentYears } from '../../students/admission/employment-history.logic';

// PR-ADMISSION-CVDATA (step 2a) — Admission Specialist CRUD over the client's employment
// history (the SAME AdmissionEmploymentEntry rows the client edits). Case-scoped, curator
// role — no DRAFT lock (staff can correct at any stage), matching staff-admission-choices.

const shape = (e: {
  id: string; employerName: string; roleTitle: string; startYear: number | null; endYear: number | null;
  isCurrent: boolean; countryOfWork: string | null; organisationField: string | null; dutiesText: string | null; sortOrder: number;
}) => ({
  id: e.id, employerName: e.employerName, roleTitle: e.roleTitle, startYear: e.startYear, endYear: e.endYear,
  isCurrent: e.isCurrent, countryOfWork: e.countryOfWork, organisationField: e.organisationField,
  dutiesText: e.dutiesText, sortOrder: e.sortOrder,
});

@Injectable()
export class StaffAdmissionEmploymentService {
  constructor(private readonly prisma: PrismaService) {}

  private async applicationId(caseId: string): Promise<string> {
    const app = await this.prisma.admissionApplication.findFirst({ where: { caseId }, select: { id: true } });
    if (!app) throw new NotFoundException('No admission application for this case yet.');
    return app.id;
  }

  private async owned(entryId: string, applicationId: string) {
    const e = await this.prisma.admissionEmploymentEntry.findUnique({ where: { id: entryId } });
    if (!e || e.admissionApplicationId !== applicationId) throw new NotFoundException('Employment entry not found on this case.');
    return e;
  }

  async list(caseId: string) {
    const applicationId = await this.applicationId(caseId);
    const rows = await this.prisma.admissionEmploymentEntry.findMany({
      where: { admissionApplicationId: applicationId }, orderBy: { sortOrder: 'asc' },
    });
    return { entries: rows.map(shape) };
  }

  async add(caseId: string, body: any) {
    const applicationId = await this.applicationId(caseId);
    if (!body?.employerName?.trim()) throw new BadRequestException('employerName is required');
    if (!body?.roleTitle?.trim()) throw new BadRequestException('roleTitle is required');
    const isCurrent = !!body.isCurrent;
    const err = validateEmploymentYears(body.startYear ?? null, body.endYear ?? null, isCurrent);
    if (err) throw new BadRequestException(err);
    const last = await this.prisma.admissionEmploymentEntry.findFirst({
      where: { admissionApplicationId: applicationId }, orderBy: { sortOrder: 'desc' },
    });
    const entry = await this.prisma.admissionEmploymentEntry.create({
      data: {
        admissionApplicationId: applicationId,
        employerName: body.employerName.trim(), roleTitle: body.roleTitle.trim(),
        startYear: body.startYear ?? null, endYear: isCurrent ? null : (body.endYear ?? null), isCurrent,
        countryOfWork: body.countryOfWork?.trim() || null, organisationField: body.organisationField?.trim() || null,
        dutiesText: body.dutiesText?.trim() || null, sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
    return shape(entry);
  }

  async update(caseId: string, entryId: string, body: any) {
    const applicationId = await this.applicationId(caseId);
    const existing = await this.owned(entryId, applicationId);
    const data: any = {};
    if (body.employerName !== undefined) { const v = String(body.employerName).trim(); if (!v) throw new BadRequestException('employerName cannot be empty'); data.employerName = v; }
    if (body.roleTitle !== undefined) { const v = String(body.roleTitle).trim(); if (!v) throw new BadRequestException('roleTitle cannot be empty'); data.roleTitle = v; }
    if (body.countryOfWork !== undefined) data.countryOfWork = body.countryOfWork == null ? null : String(body.countryOfWork).trim() || null;
    if (body.organisationField !== undefined) data.organisationField = body.organisationField == null ? null : String(body.organisationField).trim() || null;
    if (body.dutiesText !== undefined) data.dutiesText = body.dutiesText == null ? null : String(body.dutiesText).trim() || null;
    if (body.isCurrent !== undefined) data.isCurrent = !!body.isCurrent;
    if (body.startYear !== undefined) data.startYear = body.startYear == null ? null : Number(body.startYear);
    if (body.endYear !== undefined) data.endYear = body.endYear == null ? null : Number(body.endYear);
    const eff = { ...existing, ...data };
    if (eff.isCurrent) eff.endYear = null; // a current role has no end year — clear BEFORE validating
    const err = validateEmploymentYears(eff.startYear, eff.endYear, eff.isCurrent);
    if (err) throw new BadRequestException(err);
    if (eff.isCurrent) data.endYear = null;
    const entry = await this.prisma.admissionEmploymentEntry.update({ where: { id: entryId }, data });
    return shape(entry);
  }

  async remove(caseId: string, entryId: string) {
    const applicationId = await this.applicationId(caseId);
    await this.owned(entryId, applicationId);
    await this.prisma.admissionEmploymentEntry.delete({ where: { id: entryId } });
    const remaining = await this.prisma.admissionEmploymentEntry.findMany({
      where: { admissionApplicationId: applicationId }, orderBy: { sortOrder: 'asc' },
    });
    await Promise.all(remaining.map((e, i) => this.prisma.admissionEmploymentEntry.update({ where: { id: e.id }, data: { sortOrder: i } })));
    return { ok: true };
  }
}
