/* PR-PHASE32 — seed the canonical StudyField taxonomy + a starter progression
 * graph. Idempotent (upsert by key). Relations are marked APPROVED here as
 * curated starter data (staff-equivalent); production edits go PENDING→APPROVED
 * via the owner UI. `backgroundWeight` preserves q16's per-field scoring weight.
 * Run: npx ts-node scripts/seed-study-fields.ts */
import { PrismaClient, ReviewStatus } from '@prisma/client';

const prisma = new PrismaClient();

const CATEGORIES: Array<{ key: string; nameEn: string; nameFa: string; always?: boolean; order: number }> = [
  { key: 'management_business', nameEn: 'Management & Business', nameFa: 'مدیریت و کسب‌وکار', always: true, order: 1 },
  { key: 'it_data',            nameEn: 'Information Technology & Data', nameFa: 'فناوری اطلاعات و داده', order: 2 },
  { key: 'health',             nameEn: 'Healthcare & Medical', nameFa: 'بهداشت و پزشکی', order: 3 },
  { key: 'engineering',        nameEn: 'Engineering', nameFa: 'مهندسی', order: 4 },
  { key: 'trades',             nameEn: 'Construction, Trades & Infrastructure', nameFa: 'ساخت‌وساز، فنی و زیرساخت', order: 5 },
  { key: 'education',          nameEn: 'Education & Teaching', nameFa: 'آموزش و تدریس', order: 6 },
  { key: 'sciences',           nameEn: 'Science & Environment', nameFa: 'علوم و محیط‌زیست', order: 7 },
  { key: 'creative',           nameEn: 'Arts, Design & Media', nameFa: 'هنر، طراحی و رسانه', order: 8 },
  { key: 'hospitality',        nameEn: 'Hospitality, Tourism & Culinary', nameFa: 'مهمان‌نوازی، گردشگری و آشپزی', order: 9 },
  { key: 'primary_industries', nameEn: 'Agriculture & Primary Industries', nameFa: 'کشاورزی و صنایع اولیه', order: 10 },
  { key: 'other',              nameEn: 'Other / Interdisciplinary', nameFa: 'سایر / میان‌رشته‌ای', order: 11 },
];

const FIELDS: Array<{ key: string; nameEn: string; nameFa: string; cat: string; w: number }> = [
  { key: 'it_computer_science',      nameEn: 'Information Technology & Computer Science', nameFa: 'فناوری اطلاعات و علوم کامپیوتر', cat: 'it_data', w: 4 },
  { key: 'healthcare_medical',       nameEn: 'Healthcare & Medical', nameFa: 'بهداشت و پزشکی', cat: 'health', w: 4 },
  { key: 'nursing',                  nameEn: 'Nursing', nameFa: 'پرستاری', cat: 'health', w: 4 },
  { key: 'engineering',              nameEn: 'Engineering', nameFa: 'مهندسی', cat: 'engineering', w: 4 },
  { key: 'construction_trades',      nameEn: 'Construction, Trades & Infrastructure', nameFa: 'ساخت‌وساز، فنی و زیرساخت', cat: 'trades', w: 4 },
  { key: 'education_teaching',       nameEn: 'Education & Teaching', nameFa: 'آموزش و تدریس', cat: 'education', w: 4 },
  { key: 'agriculture',              nameEn: 'Agriculture & Primary Industries', nameFa: 'کشاورزی و صنایع اولیه', cat: 'primary_industries', w: 4 },
  { key: 'business_management',      nameEn: 'Business & Management', nameFa: 'کسب‌وکار و مدیریت', cat: 'management_business', w: 3 },
  { key: 'project_management',       nameEn: 'Project Management', nameFa: 'مدیریت پروژه', cat: 'management_business', w: 3 },
  { key: 'healthcare_management',    nameEn: 'Healthcare Management', nameFa: 'مدیریت بهداشت و درمان', cat: 'management_business', w: 3 },
  { key: 'hospitality_management',   nameEn: 'Hospitality Management', nameFa: 'مدیریت مهمان‌نوازی', cat: 'management_business', w: 3 },
  { key: 'science_environment',      nameEn: 'Science & Environment', nameFa: 'علوم و محیط‌زیست', cat: 'sciences', w: 3 },
  { key: 'aviation_transport',       nameEn: 'Aviation, Maritime & Transport', nameFa: 'هوانوردی، دریانوردی و حمل‌ونقل', cat: 'other', w: 3 },
  { key: 'hospitality_culinary',     nameEn: 'Hospitality, Tourism & Culinary', nameFa: 'مهمان‌نوازی، گردشگری و آشپزی', cat: 'hospitality', w: 3 },
  { key: 'media_communication',      nameEn: 'Media & Communication', nameFa: 'رسانه و ارتباطات', cat: 'creative', w: 2 },
  { key: 'arts_design',              nameEn: 'Arts, Design & Creative Industries', nameFa: 'هنر، طراحی و صنایع خلاق', cat: 'creative', w: 2 },
  { key: 'law_government',           nameEn: 'Law, Politics & Government', nameFa: 'حقوق، سیاست و دولت', cat: 'other', w: 2 },
  { key: 'general_interdisciplinary', nameEn: 'General / Interdisciplinary', nameFa: 'عمومی / میان‌رشته‌ای', cat: 'other', w: 1 },
  { key: 'other',                    nameEn: 'Other', nameFa: 'سایر', cat: 'other', w: 0 },
  // PR-PHASE34 — added for the NZ ITP import (subject areas with no prior fit).
  // backgroundWeight 0: these map to q16 'Other' (no scored q16 option existed for
  // them, so byte-identical scoring is preserved).
  { key: 'personal_services',   nameEn: 'Personal Services (Beauty & Hair)', nameFa: 'خدمات فردی (زیبایی و آرایش)', cat: 'other', w: 0 },
  { key: 'sport_recreation',    nameEn: 'Sport & Recreation', nameFa: 'ورزش و تفریحات', cat: 'health', w: 0 },
  { key: 'social_community',    nameEn: 'Social & Community Services', nameFa: 'خدمات اجتماعی و اجتماع‌محور', cat: 'education', w: 0 },
  { key: 'foundation_pathways', nameEn: 'Foundation & Pathways', nameFa: 'دوره‌های پایه و آماده‌سازی', cat: 'other', w: 0 },
];

// Directed progression edges (source qual field → allowed target). Management &
// Business is always-selectable so needs no edges. Same-field is implicit.
const RELATIONS: Array<[string, string]> = [
  ['it_computer_science', 'science_environment'],
  ['engineering', 'it_computer_science'],
  ['engineering', 'construction_trades'],
  ['construction_trades', 'engineering'],
  ['healthcare_medical', 'nursing'],
  ['nursing', 'healthcare_medical'],
  ['healthcare_medical', 'science_environment'],
  ['science_environment', 'it_computer_science'],
  ['science_environment', 'healthcare_medical'],
  ['agriculture', 'science_environment'],
  ['media_communication', 'arts_design'],
  ['arts_design', 'media_communication'],
];

async function main() {
  const catId: Record<string, string> = {};
  for (const c of CATEGORIES) {
    const row = await prisma.studyFieldCategory.upsert({
      where: { key: c.key },
      update: { nameEn: c.nameEn, nameFa: c.nameFa, alwaysSelectable: !!c.always, displayOrder: c.order },
      create: { key: c.key, nameEn: c.nameEn, nameFa: c.nameFa, alwaysSelectable: !!c.always, displayOrder: c.order },
    });
    catId[c.key] = row.id;
  }
  const fieldId: Record<string, string> = {};
  for (const [i, f] of FIELDS.entries()) {
    const row = await prisma.studyField.upsert({
      where: { key: f.key },
      update: { nameEn: f.nameEn, nameFa: f.nameFa, categoryId: catId[f.cat], backgroundWeight: f.w, displayOrder: i + 1 },
      create: { key: f.key, nameEn: f.nameEn, nameFa: f.nameFa, categoryId: catId[f.cat], backgroundWeight: f.w, displayOrder: i + 1 },
    });
    fieldId[f.key] = row.id;
  }
  for (const [src, tgt] of RELATIONS) {
    await prisma.studyFieldRelation.upsert({
      where: { sourceFieldId_targetFieldId: { sourceFieldId: fieldId[src], targetFieldId: fieldId[tgt] } },
      update: { reviewStatus: ReviewStatus.APPROVED },
      create: { sourceFieldId: fieldId[src], targetFieldId: fieldId[tgt], reviewStatus: ReviewStatus.APPROVED },
    });
  }
  console.log(`Seeded: ${CATEGORIES.length} categories, ${FIELDS.length} fields, ${RELATIONS.length} relations (APPROVED).`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
