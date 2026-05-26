import { notFound } from 'next/navigation';
import { FileSearch, Inbox } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/Card';
import { BackLink } from '@/components/ui/BackLink';
import { apiServer, ApiServerError } from '@/lib/apiServer';
import { formatRelative, formatDate } from '../../../_utils/format';
import { CopyButton } from './CopyButton';
import { InzSection } from './InzSection';

// PR-LIA-6 — Consolidated INZ application data viewer for the LIA.
// Read-only. Every section ships with a copy-to-clipboard button.

interface InzData {
  generatedAt: string;
  case: {
    id: string;
    stage: string;
    createdAt: string;
    // PR-LIA-7: surfaced for the "submitted to INZ" banner.
    inzApplicationNumber: string | null;
    inzSubmittedAt: string | null;
    // PR-LIA-8: visa outcome banner (issued / declined). Both null on
    // cases that haven't reached COMPLETED with a visa record.
    visaOutcome: 'APPROVED' | 'DECLINED' | null;
    visaEndDate: string | null;
    visaIssuedAt: string | null;
  } | null;
  applicant: {
    fullName: string | null;
    dateOfBirth: string | null;
    gender: string | null;
    email: string | null;
    phone: string | null;
    countryOfBirth: string | null;
    countryOfResidence: string | null;
    passportNumber: string | null;
    passportExpiry: string | null;
    passportCountry: string | null;
  };
  citizenships: Array<{ id: string; country: string; holdsPassport: boolean | null }>;
  tbCountries: Array<{ id: string; country: string; totalDurationDays: number | null }>;
  educationEntries: Array<{
    id: string;
    institution: string;
    qualification: string;
    fieldOfStudy: string | null;
    startYear: number | null;
    endYear: number | null;
    country: string;
    completed: boolean;
    supplement: {
      startMonth: number | null;
      endMonth: number | null;
      institutionState: string | null;
      institutionTown: string | null;
      qualificationAwarded: boolean | null;
    } | null;
  }>;
  employmentEntries: Array<{
    id: string;
    entryKind: string;
    employer: string | null;
    role: string | null;
    duties: string | null;
    startDate: string | null;
    endDate: string | null;
    country: string | null;
    state: string | null;
    supervisorName: string | null;
  }>;
  unemploymentEntries: Array<{
    id: string;
    startDate: string | null;
    endDate: string | null;
    activity: string | null;
    financialSupport: string | null;
  }>;
  partner: {
    id: string;
    fullName: string;
    dateOfBirth: string | null;
    gender: string | null;
    relationshipStatus: string | null;
    countryOfBirth: string | null;
    nationality: string | null;
    countryOfResidence: string | null;
    occupation: string | null;
    passportNumber: string | null;
    passportCountry: string | null;
  } | null;
  formerPartners: Array<{
    id: string;
    fullName: string;
    dateOfBirth: string | null;
    relationshipStatus: string | null;
    countryOfBirth: string | null;
    nationality: string | null;
  }>;
  children: Array<{
    id: string;
    fullName: string;
    dateOfBirth: string | null;
    countryOfBirth: string | null;
    nationality: string | null;
    livesWithApplicant: boolean | null;
  }>;
  parents: Array<{
    id: string;
    fullName: string;
    relationshipToApplicant: string | null;
    isDeceased: boolean | null;
    dateOfBirth: string | null;
    countryOfResidence: string | null;
    occupation: string | null;
  }>;
  siblings: Array<{
    id: string;
    fullName: string;
    relationshipToApplicant: string | null;
    dateOfBirth: string | null;
    countryOfResidence: string | null;
    occupation: string | null;
  }>;
  nzContacts: Array<{
    id: string;
    fullName: string;
    relationshipToApplicant: string | null;
    phone: string | null;
    email: string | null;
    street: string | null;
    suburb: string | null;
    townCity: string | null;
    region: string | null;
    postcode: string | null;
  }>;
  militaryHistory: {
    everUndertakenMilitaryService: boolean | null;
    militaryServiceCompulsoryHome: boolean | null;
    wasExemptFromMilitaryService: boolean | null;
    exemptExplanation: string | null;
    services: Array<{
      id: string;
      dateStarted: string | null;
      dateFinished: string | null;
      location: string | null;
      corps: string | null;
      rank: string | null;
      duties: string | null;
      commandingOfficer: string | null;
    }>;
  } | null;
  travelHistory: Array<{
    id: string;
    destination: string;
    dateEnteredMonth: number | null;
    dateEnteredYear: number | null;
    dateExitedMonth: number | null;
    dateExitedYear: number | null;
    arrivalMode: string | null;
    pointOfEntry: string | null;
    purposeOfTravel: string | null;
    otherPurpose: string | null;
  }>;
  immigrationAssistance: {
    completingOnBehalf: boolean | null;
    capacity: string | null;
    adviserNumber: string | null;
    adviserFullName: string | null;
    adviserEmail: string | null;
    adviserContactNumber: string | null;
    adviserIsPrimaryContact: boolean | null;
  } | null;
  supportingDocuments: Array<{
    id: string;
    docType: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    uploadedAt: string;
  }>;
  completeness: {
    applicant: { filled: number; total: number };
    citizenships: { count: number };
    tbCountries: { count: number };
    educationEntries: { count: number };
    employmentEntries: { count: number };
    unemploymentEntries: { count: number };
    family: {
      partner: boolean;
      formerPartners: number;
      children: number;
      parents: number;
      siblings: number;
    };
    nzContacts: { count: number };
    militaryHistory: { filled: boolean };
    travelHistory: { count: number };
    immigrationAssistance: { filled: boolean };
    supportingDocuments: { count: number };
  };
}

export default async function InzDataPage({ params }: { params: { id: string } }) {
  let data: InzData | null = null;
  let errorMsg: string | null = null;

  try {
    data = await apiServer.get<InzData>(`/cases/${params.id}/inz-data`);
  } catch (e) {
    if (e instanceof ApiServerError && e.statusCode === 404) notFound();
    errorMsg = e instanceof ApiServerError ? e.message : 'Failed to load INZ data.';
  }

  if (errorMsg || !data) {
    return (
      <div className="max-w-4xl">
        <BackLink href={`/lia/cases/${params.id}`} label="Back to case" />
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-4 text-sm text-red-800">{errorMsg ?? 'INZ data unavailable.'}</CardContent>
        </Card>
      </div>
    );
  }

  const applicantText = serialiseApplicant(data.applicant);
  const entirePayloadText = serialiseEntire(data);

  return (
    <div className="max-w-4xl">
      <BackLink href={`/lia/cases/${params.id}`} label="Back to case" />

      <div className="flex items-start justify-between flex-wrap gap-3 mb-6">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-[#1E3A5F] flex items-center gap-2">
            <FileSearch size={22} className="text-[#E8B923]" />
            INZ Application Data
          </h1>
          <p className="text-sm text-[#4A4A4A]/70 mt-1">
            {data.applicant.fullName ?? '(unknown applicant)'} ·{' '}
            <span className="text-[#4A4A4A]/50">read-only · every view is audited</span>
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#FAF8F3] text-[#4A4A4A] border border-gray-200">
            Generated {formatRelative(data.generatedAt)}
          </span>
          <CopyButton text={entirePayloadText} variant="section" label="Copy entire application" />
        </div>
      </div>

      {data.case?.stage === 'INZ_SUBMITTED' && data.case.inzApplicationNumber && data.case.inzSubmittedAt && (
        <div className="mb-6 rounded-xl border border-[#E8B923]/40 bg-[#E8B923]/10 px-4 py-3 flex items-start gap-2 flex-wrap">
          <span className="text-emerald-700 font-bold text-lg leading-6">✓</span>
          <p className="text-sm text-[#1E3A5F] flex-1 min-w-0">
            This case was submitted to INZ on{' '}
            <strong>{formatDate(data.case.inzSubmittedAt)}</strong> with reference{' '}
            <code className="font-mono bg-white px-1.5 py-0.5 rounded text-[#1E3A5F]">{data.case.inzApplicationNumber}</code>.
            The data below was already lodged.
          </p>
        </div>
      )}

      {data.case?.visaOutcome === 'APPROVED' && data.case.visaIssuedAt && (
        <div className="mb-6 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 flex items-start gap-2 flex-wrap">
          <span className="text-emerald-700 font-bold text-lg leading-6">✓</span>
          <p className="text-sm text-emerald-900 flex-1 min-w-0">
            Visa issued <strong>{formatDate(data.case.visaIssuedAt)}</strong>
            {data.case.visaEndDate && (<> — valid until <strong>{formatDate(data.case.visaEndDate)}</strong></>)}.
          </p>
        </div>
      )}

      {data.case?.visaOutcome === 'DECLINED' && data.case.visaIssuedAt && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2 flex-wrap">
          <span className="text-red-700 font-bold text-lg leading-6">✗</span>
          <p className="text-sm text-red-900 flex-1 min-w-0">
            Visa application declined <strong>{formatDate(data.case.visaIssuedAt)}</strong>. The data below was lodged with INZ.
          </p>
        </div>
      )}

      <InzSection
        title="Applicant"
        badge={`${data.completeness.applicant.filled} of ${data.completeness.applicant.total} fields`}
        badgeTone={
          data.completeness.applicant.filled === 0
            ? 'gray'
            : data.completeness.applicant.filled === data.completeness.applicant.total
              ? 'emerald'
              : 'blue'
        }
        copyText={applicantText}
        defaultOpen={data.completeness.applicant.filled > 0}
      >
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
          <FieldRow label="Full name" value={data.applicant.fullName} />
          <FieldRow label="Date of birth" value={data.applicant.dateOfBirth} />
          <FieldRow label="Gender" value={data.applicant.gender} />
          <FieldRow label="Email" value={data.applicant.email} />
          <FieldRow label="Phone" value={data.applicant.phone} />
          <FieldRow label="Country of birth" value={data.applicant.countryOfBirth} />
          <FieldRow label="Country of residence" value={data.applicant.countryOfResidence} />
          <FieldRow label="Passport number" value={data.applicant.passportNumber} />
          <FieldRow label="Passport expiry" value={data.applicant.passportExpiry} />
          <FieldRow label="Passport country of issue" value={data.applicant.passportCountry} />
        </dl>
      </InzSection>

      <InzSection
        title="Other citizenships"
        badge={data.citizenships.length === 1 ? '1 entry' : `${data.citizenships.length} entries`}
        badgeTone={data.citizenships.length === 0 ? 'gray' : 'emerald'}
        copyText={serialiseList('Other citizenships', data.citizenships.map(c => `Country: ${c.country}\nHolds passport: ${yesno(c.holdsPassport)}`))}
        defaultOpen={data.citizenships.length > 0}
      >
        {data.citizenships.length === 0
          ? <EmptyMsg />
          : (
            <ul className="space-y-3">
              {data.citizenships.map((c) => (
                <EntryCard
                  key={c.id}
                  copyText={`Country: ${c.country}\nHolds passport: ${yesno(c.holdsPassport)}`}
                >
                  <FieldRow label="Country" value={c.country} />
                  <FieldRow label="Holds passport" value={yesno(c.holdsPassport)} />
                </EntryCard>
              ))}
            </ul>
          )}
      </InzSection>

      <InzSection
        title="TB-risk countries (12+ months)"
        badge={data.tbCountries.length === 1 ? '1 entry' : `${data.tbCountries.length} entries`}
        badgeTone={data.tbCountries.length === 0 ? 'gray' : 'emerald'}
        copyText={serialiseList(
          'TB countries',
          data.tbCountries.map(c => `Country: ${c.country}\nDuration (days): ${c.totalDurationDays ?? '—'}`),
        )}
        defaultOpen={data.tbCountries.length > 0}
      >
        {data.tbCountries.length === 0
          ? <EmptyMsg />
          : (
            <ul className="space-y-3">
              {data.tbCountries.map(c => (
                <EntryCard
                  key={c.id}
                  copyText={`Country: ${c.country}\nDuration (days): ${c.totalDurationDays ?? '—'}`}
                >
                  <FieldRow label="Country" value={c.country} />
                  <FieldRow label="Duration (days)" value={c.totalDurationDays?.toString() ?? null} />
                </EntryCard>
              ))}
            </ul>
          )}
      </InzSection>

      <InzSection
        title="Education entries"
        badge={data.educationEntries.length === 1 ? '1 entry' : `${data.educationEntries.length} entries`}
        badgeTone={data.educationEntries.length === 0 ? 'gray' : 'emerald'}
        copyText={serialiseList(
          'Education entries',
          data.educationEntries.map(e => formatEducation(e)),
        )}
        defaultOpen={data.educationEntries.length > 0}
      >
        {data.educationEntries.length === 0
          ? <EmptyMsg />
          : (
            <ul className="space-y-3">
              {data.educationEntries.map(e => (
                <EntryCard key={e.id} copyText={formatEducation(e)}>
                  <FieldRow label="Institution" value={e.institution} />
                  <FieldRow label="Qualification" value={e.qualification} />
                  <FieldRow label="Field of study" value={e.fieldOfStudy} />
                  <FieldRow label="Country" value={e.country} />
                  <FieldRow label="Start year" value={e.startYear?.toString() ?? null} />
                  <FieldRow label="End year" value={e.endYear?.toString() ?? null} />
                  <FieldRow label="Completed" value={yesno(e.completed)} />
                  {e.supplement && (
                    <>
                      <FieldRow label="Start month" value={e.supplement.startMonth?.toString() ?? null} />
                      <FieldRow label="End month" value={e.supplement.endMonth?.toString() ?? null} />
                      <FieldRow label="Institution state" value={e.supplement.institutionState} />
                      <FieldRow label="Institution town" value={e.supplement.institutionTown} />
                      <FieldRow label="Qualification awarded" value={yesno(e.supplement.qualificationAwarded)} />
                    </>
                  )}
                </EntryCard>
              ))}
            </ul>
          )}
      </InzSection>

      <InzSection
        title="Employment history"
        badge={data.employmentEntries.length === 1 ? '1 entry' : `${data.employmentEntries.length} entries`}
        badgeTone={data.employmentEntries.length === 0 ? 'gray' : 'emerald'}
        copyText={serialiseList('Employment history', data.employmentEntries.map(e => formatEmployment(e)))}
        defaultOpen={data.employmentEntries.length > 0}
      >
        {data.employmentEntries.length === 0
          ? <EmptyMsg />
          : (
            <ul className="space-y-3">
              {data.employmentEntries.map(e => (
                <EntryCard key={e.id} copyText={formatEmployment(e)}>
                  <FieldRow label="Kind" value={e.entryKind} />
                  <FieldRow label="Employer" value={e.employer} />
                  <FieldRow label="Role" value={e.role} />
                  <FieldRow label="Start date" value={formatDateOrNull(e.startDate)} />
                  <FieldRow label="End date" value={formatDateOrNull(e.endDate)} />
                  <FieldRow label="Country" value={e.country} />
                  <FieldRow label="State" value={e.state} />
                  <FieldRow label="Supervisor" value={e.supervisorName} />
                  <FieldRow label="Duties" value={e.duties} long />
                </EntryCard>
              ))}
            </ul>
          )}
      </InzSection>

      <InzSection
        title="Unemployment periods"
        badge={data.unemploymentEntries.length === 1 ? '1 entry' : `${data.unemploymentEntries.length} entries`}
        badgeTone={data.unemploymentEntries.length === 0 ? 'gray' : 'emerald'}
        copyText={serialiseList('Unemployment periods', data.unemploymentEntries.map(u => formatUnemployment(u)))}
        defaultOpen={data.unemploymentEntries.length > 0}
      >
        {data.unemploymentEntries.length === 0
          ? <EmptyMsg />
          : (
            <ul className="space-y-3">
              {data.unemploymentEntries.map(u => (
                <EntryCard key={u.id} copyText={formatUnemployment(u)}>
                  <FieldRow label="Start date" value={formatDateOrNull(u.startDate)} />
                  <FieldRow label="End date" value={formatDateOrNull(u.endDate)} />
                  <FieldRow label="Activity" value={u.activity} long />
                  <FieldRow label="Financial support" value={u.financialSupport} long />
                </EntryCard>
              ))}
            </ul>
          )}
      </InzSection>

      <InzSection
        title="Partner"
        badge={data.partner ? 'Recorded' : 'Not recorded'}
        badgeTone={data.partner ? 'emerald' : 'gray'}
        copyText={data.partner ? formatPartner(data.partner) : 'Partner: (none recorded)'}
        defaultOpen={!!data.partner}
      >
        {data.partner ? (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <FieldRow label="Full name" value={data.partner.fullName} />
            <FieldRow label="Date of birth" value={formatDateOrNull(data.partner.dateOfBirth)} />
            <FieldRow label="Gender" value={data.partner.gender} />
            <FieldRow label="Relationship status" value={data.partner.relationshipStatus} />
            <FieldRow label="Country of birth" value={data.partner.countryOfBirth} />
            <FieldRow label="Nationality" value={data.partner.nationality} />
            <FieldRow label="Country of residence" value={data.partner.countryOfResidence} />
            <FieldRow label="Occupation" value={data.partner.occupation} />
            <FieldRow label="Passport number" value={data.partner.passportNumber} />
            <FieldRow label="Passport country" value={data.partner.passportCountry} />
          </dl>
        ) : <EmptyMsg />}
      </InzSection>

      <InzSection
        title="Former partners"
        badge={data.formerPartners.length === 1 ? '1 entry' : `${data.formerPartners.length} entries`}
        badgeTone={data.formerPartners.length === 0 ? 'gray' : 'emerald'}
        copyText={serialiseList('Former partners', data.formerPartners.map(p => formatFormerPartner(p)))}
        defaultOpen={data.formerPartners.length > 0}
      >
        {data.formerPartners.length === 0
          ? <EmptyMsg />
          : (
            <ul className="space-y-3">
              {data.formerPartners.map(p => (
                <EntryCard key={p.id} copyText={formatFormerPartner(p)}>
                  <FieldRow label="Full name" value={p.fullName} />
                  <FieldRow label="Date of birth" value={formatDateOrNull(p.dateOfBirth)} />
                  <FieldRow label="Relationship status" value={p.relationshipStatus} />
                  <FieldRow label="Country of birth" value={p.countryOfBirth} />
                  <FieldRow label="Nationality" value={p.nationality} />
                </EntryCard>
              ))}
            </ul>
          )}
      </InzSection>

      <InzSection
        title="Children"
        badge={data.children.length === 1 ? '1 entry' : `${data.children.length} entries`}
        badgeTone={data.children.length === 0 ? 'gray' : 'emerald'}
        copyText={serialiseList('Children', data.children.map(c => formatChild(c)))}
        defaultOpen={data.children.length > 0}
      >
        {data.children.length === 0
          ? <EmptyMsg />
          : (
            <ul className="space-y-3">
              {data.children.map(c => (
                <EntryCard key={c.id} copyText={formatChild(c)}>
                  <FieldRow label="Full name" value={c.fullName} />
                  <FieldRow label="Date of birth" value={formatDateOrNull(c.dateOfBirth)} />
                  <FieldRow label="Country of birth" value={c.countryOfBirth} />
                  <FieldRow label="Nationality" value={c.nationality} />
                  <FieldRow label="Lives with applicant" value={yesno(c.livesWithApplicant)} />
                </EntryCard>
              ))}
            </ul>
          )}
      </InzSection>

      <InzSection
        title="Parents"
        badge={data.parents.length === 1 ? '1 entry' : `${data.parents.length} entries`}
        badgeTone={data.parents.length === 0 ? 'gray' : 'emerald'}
        copyText={serialiseList('Parents', data.parents.map(p => formatParent(p)))}
        defaultOpen={data.parents.length > 0}
      >
        {data.parents.length === 0
          ? <EmptyMsg />
          : (
            <ul className="space-y-3">
              {data.parents.map(p => (
                <EntryCard key={p.id} copyText={formatParent(p)}>
                  <FieldRow label="Full name" value={p.fullName} />
                  <FieldRow label="Relationship" value={p.relationshipToApplicant} />
                  <FieldRow label="Deceased" value={yesno(p.isDeceased)} />
                  <FieldRow label="Date of birth" value={formatDateOrNull(p.dateOfBirth)} />
                  <FieldRow label="Country of residence" value={p.countryOfResidence} />
                  <FieldRow label="Occupation" value={p.occupation} />
                </EntryCard>
              ))}
            </ul>
          )}
      </InzSection>

      <InzSection
        title="Siblings"
        badge={data.siblings.length === 1 ? '1 entry' : `${data.siblings.length} entries`}
        badgeTone={data.siblings.length === 0 ? 'gray' : 'emerald'}
        copyText={serialiseList('Siblings', data.siblings.map(s => formatSibling(s)))}
        defaultOpen={data.siblings.length > 0}
      >
        {data.siblings.length === 0
          ? <EmptyMsg />
          : (
            <ul className="space-y-3">
              {data.siblings.map(s => (
                <EntryCard key={s.id} copyText={formatSibling(s)}>
                  <FieldRow label="Full name" value={s.fullName} />
                  <FieldRow label="Relationship" value={s.relationshipToApplicant} />
                  <FieldRow label="Date of birth" value={formatDateOrNull(s.dateOfBirth)} />
                  <FieldRow label="Country of residence" value={s.countryOfResidence} />
                  <FieldRow label="Occupation" value={s.occupation} />
                </EntryCard>
              ))}
            </ul>
          )}
      </InzSection>

      <InzSection
        title="NZ contacts"
        badge={data.nzContacts.length === 1 ? '1 entry' : `${data.nzContacts.length} entries`}
        badgeTone={data.nzContacts.length === 0 ? 'gray' : 'emerald'}
        copyText={serialiseList('NZ contacts', data.nzContacts.map(c => formatNzContact(c)))}
        defaultOpen={data.nzContacts.length > 0}
      >
        {data.nzContacts.length === 0
          ? <EmptyMsg />
          : (
            <ul className="space-y-3">
              {data.nzContacts.map(c => (
                <EntryCard key={c.id} copyText={formatNzContact(c)}>
                  <FieldRow label="Full name" value={c.fullName} />
                  <FieldRow label="Relationship" value={c.relationshipToApplicant} />
                  <FieldRow label="Phone" value={c.phone} />
                  <FieldRow label="Email" value={c.email} />
                  <FieldRow label="Street" value={c.street} />
                  <FieldRow label="Suburb" value={c.suburb} />
                  <FieldRow label="Town / City" value={c.townCity} />
                  <FieldRow label="Region" value={c.region} />
                  <FieldRow label="Postcode" value={c.postcode} />
                </EntryCard>
              ))}
            </ul>
          )}
      </InzSection>

      <InzSection
        title="Military history"
        badge={data.completeness.militaryHistory.filled ? 'Recorded' : 'Not recorded'}
        badgeTone={data.completeness.militaryHistory.filled ? 'emerald' : 'gray'}
        copyText={data.militaryHistory ? formatMilitary(data.militaryHistory) : 'Military history: (none recorded)'}
        defaultOpen={data.completeness.militaryHistory.filled}
      >
        {data.militaryHistory ? (
          <>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
              <FieldRow label="Ever undertaken military service" value={yesno(data.militaryHistory.everUndertakenMilitaryService)} />
              <FieldRow label="Compulsory in home country" value={yesno(data.militaryHistory.militaryServiceCompulsoryHome)} />
              <FieldRow label="Exempt" value={yesno(data.militaryHistory.wasExemptFromMilitaryService)} />
              <FieldRow label="Exemption explanation" value={data.militaryHistory.exemptExplanation} long />
            </dl>
            {data.militaryHistory.services.length > 0 && (
              <>
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#4A4A4A]/60 mb-2">Service records</h3>
                <ul className="space-y-3">
                  {data.militaryHistory.services.map(s => (
                    <EntryCard key={s.id} copyText={formatMilitaryService(s)}>
                      <FieldRow label="Date started" value={formatDateOrNull(s.dateStarted)} />
                      <FieldRow label="Date finished" value={formatDateOrNull(s.dateFinished)} />
                      <FieldRow label="Location" value={s.location} />
                      <FieldRow label="Corps" value={s.corps} />
                      <FieldRow label="Rank" value={s.rank} />
                      <FieldRow label="Commanding officer" value={s.commandingOfficer} />
                      <FieldRow label="Duties" value={s.duties} long />
                    </EntryCard>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : <EmptyMsg />}
      </InzSection>

      <InzSection
        title="Travel history"
        badge={data.travelHistory.length === 1 ? '1 entry' : `${data.travelHistory.length} entries`}
        badgeTone={data.travelHistory.length === 0 ? 'gray' : 'emerald'}
        copyText={serialiseList('Travel history', data.travelHistory.map(t => formatTravel(t)))}
        defaultOpen={data.travelHistory.length > 0}
      >
        {data.travelHistory.length === 0
          ? <EmptyMsg />
          : (
            <ul className="space-y-3">
              {data.travelHistory.map(t => (
                <EntryCard key={t.id} copyText={formatTravel(t)}>
                  <FieldRow label="Destination" value={t.destination} />
                  <FieldRow label="Entered" value={joinMonthYear(t.dateEnteredMonth, t.dateEnteredYear)} />
                  <FieldRow label="Exited" value={joinMonthYear(t.dateExitedMonth, t.dateExitedYear)} />
                  <FieldRow label="Arrival mode" value={t.arrivalMode} />
                  <FieldRow label="Point of entry" value={t.pointOfEntry} />
                  <FieldRow label="Purpose" value={t.purposeOfTravel} />
                  <FieldRow label="Other purpose" value={t.otherPurpose} long />
                </EntryCard>
              ))}
            </ul>
          )}
      </InzSection>

      <InzSection
        title="Immigration assistance"
        badge={data.completeness.immigrationAssistance.filled ? 'Recorded' : 'Not recorded'}
        badgeTone={data.completeness.immigrationAssistance.filled ? 'emerald' : 'gray'}
        copyText={data.immigrationAssistance ? formatAssistance(data.immigrationAssistance) : 'Immigration assistance: (none recorded)'}
        defaultOpen={data.completeness.immigrationAssistance.filled}
      >
        {data.immigrationAssistance ? (
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <FieldRow label="Completed on behalf" value={yesno(data.immigrationAssistance.completingOnBehalf)} />
            <FieldRow label="Capacity" value={data.immigrationAssistance.capacity} />
            <FieldRow label="Adviser full name" value={data.immigrationAssistance.adviserFullName} />
            <FieldRow label="Adviser number" value={data.immigrationAssistance.adviserNumber} />
            <FieldRow label="Adviser email" value={data.immigrationAssistance.adviserEmail} />
            <FieldRow label="Adviser contact" value={data.immigrationAssistance.adviserContactNumber} />
            <FieldRow label="Adviser is primary contact" value={yesno(data.immigrationAssistance.adviserIsPrimaryContact)} />
          </dl>
        ) : <EmptyMsg />}
      </InzSection>

      <InzSection
        title="Supporting documents"
        badge={data.supportingDocuments.length === 1 ? '1 document' : `${data.supportingDocuments.length} documents`}
        badgeTone={data.supportingDocuments.length === 0 ? 'gray' : 'emerald'}
        copyText={serialiseList('Supporting documents', data.supportingDocuments.map(d => `Type: ${d.docType}\nFilename: ${d.fileName}\nUploaded: ${formatDate(d.uploadedAt)}`))}
        defaultOpen={data.supportingDocuments.length > 0}
      >
        {data.supportingDocuments.length === 0
          ? <EmptyMsg />
          : (
            <ul className="space-y-2 text-sm">
              {data.supportingDocuments.map(d => (
                <li key={d.id} className="flex items-center gap-2 flex-wrap py-1.5 border-b border-gray-100 last:border-b-0">
                  <span className="font-semibold text-[#1E3A5F] min-w-[10rem]">{d.docType}</span>
                  <span className="text-[#4A4A4A] truncate flex-1 min-w-0" title={d.fileName}>{d.fileName}</span>
                  <span className="text-xs text-[#4A4A4A]/60">{formatDate(d.uploadedAt)}</span>
                </li>
              ))}
            </ul>
          )}
      </InzSection>
    </div>
  );
}

// ─── Field / entry rendering helpers ─────────────────────────────────────

function FieldRow({ label, value, long }: { label: string; value: string | null; long?: boolean }) {
  return (
    <div className={`flex ${long ? 'flex-col gap-0.5 sm:col-span-2' : 'items-center gap-2'} py-1 border-b border-gray-50 last:border-b-0`}>
      <dt className={`text-xs font-semibold text-[#4A4A4A]/70 ${long ? '' : 'min-w-[8rem]'}`}>{label}</dt>
      <dd className="text-sm text-[#1E3A5F] whitespace-pre-wrap break-words flex-1 min-w-0">
        {value && value.length > 0 ? value : <span className="text-[#4A4A4A]/40">—</span>}
      </dd>
      {value && value.length > 0 && (
        <CopyButton text={value} variant="field" ariaLabel={`Copy ${label}`} />
      )}
    </div>
  );
}

function EntryCard({ children, copyText }: { children: React.ReactNode; copyText: string }) {
  return (
    <li className="rounded-xl border border-gray-100 bg-[#FAF8F3]/40 p-3">
      <div className="flex justify-end mb-2">
        <CopyButton text={copyText} variant="entry" />
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {children}
      </dl>
    </li>
  );
}

function EmptyMsg() {
  return (
    <div className="flex items-center gap-2 text-sm text-[#4A4A4A]/60 py-3">
      <Inbox size={14} /> No data entered yet.
    </div>
  );
}

// ─── Pure formatters ─────────────────────────────────────────────────────

function yesno(v: boolean | null): string | null {
  if (v === true) return 'Yes';
  if (v === false) return 'No';
  return null;
}

function formatDateOrNull(date: string | null): string | null {
  if (!date) return null;
  return formatDate(date);
}

function joinMonthYear(m: number | null, y: number | null): string | null {
  if (!m && !y) return null;
  if (m && y) return `${String(m).padStart(2, '0')}/${y}`;
  return String(m ?? y);
}

function serialiseApplicant(a: InzData['applicant']): string {
  const lines = [
    `Full name: ${a.fullName ?? '—'}`,
    `Date of birth: ${a.dateOfBirth ?? '—'}`,
    `Gender: ${a.gender ?? '—'}`,
    `Email: ${a.email ?? '—'}`,
    `Phone: ${a.phone ?? '—'}`,
    `Country of birth: ${a.countryOfBirth ?? '—'}`,
    `Country of residence: ${a.countryOfResidence ?? '—'}`,
    `Passport number: ${a.passportNumber ?? '—'}`,
    `Passport expiry: ${a.passportExpiry ?? '—'}`,
    `Passport country: ${a.passportCountry ?? '—'}`,
  ];
  return `Applicant\n\n${lines.join('\n')}`;
}

function serialiseList(title: string, entries: string[]): string {
  if (entries.length === 0) return `${title}\n\n(none recorded)`;
  return `${title}\n\n${entries.join('\n\n')}`;
}

function formatEducation(e: InzData['educationEntries'][number]): string {
  const lines = [
    `Institution: ${e.institution}`,
    `Qualification: ${e.qualification}`,
    `Field of study: ${e.fieldOfStudy ?? '—'}`,
    `Country: ${e.country}`,
    `Start year: ${e.startYear ?? '—'}`,
    `End year: ${e.endYear ?? '—'}`,
    `Completed: ${yesno(e.completed) ?? '—'}`,
  ];
  if (e.supplement) {
    lines.push(
      `Start month: ${e.supplement.startMonth ?? '—'}`,
      `End month: ${e.supplement.endMonth ?? '—'}`,
      `Institution state: ${e.supplement.institutionState ?? '—'}`,
      `Institution town: ${e.supplement.institutionTown ?? '—'}`,
      `Qualification awarded: ${yesno(e.supplement.qualificationAwarded) ?? '—'}`,
    );
  }
  return lines.join('\n');
}

function formatEmployment(e: InzData['employmentEntries'][number]): string {
  return [
    `Kind: ${e.entryKind}`,
    `Employer: ${e.employer ?? '—'}`,
    `Role: ${e.role ?? '—'}`,
    `Start: ${formatDateOrNull(e.startDate) ?? '—'}`,
    `End: ${formatDateOrNull(e.endDate) ?? '—'}`,
    `Country: ${e.country ?? '—'}`,
    `State: ${e.state ?? '—'}`,
    `Supervisor: ${e.supervisorName ?? '—'}`,
    `Duties: ${e.duties ?? '—'}`,
  ].join('\n');
}

function formatUnemployment(u: InzData['unemploymentEntries'][number]): string {
  return [
    `Start: ${formatDateOrNull(u.startDate) ?? '—'}`,
    `End: ${formatDateOrNull(u.endDate) ?? '—'}`,
    `Activity: ${u.activity ?? '—'}`,
    `Financial support: ${u.financialSupport ?? '—'}`,
  ].join('\n');
}

function formatPartner(p: NonNullable<InzData['partner']>): string {
  return [
    `Full name: ${p.fullName}`,
    `Date of birth: ${formatDateOrNull(p.dateOfBirth) ?? '—'}`,
    `Gender: ${p.gender ?? '—'}`,
    `Relationship status: ${p.relationshipStatus ?? '—'}`,
    `Country of birth: ${p.countryOfBirth ?? '—'}`,
    `Nationality: ${p.nationality ?? '—'}`,
    `Country of residence: ${p.countryOfResidence ?? '—'}`,
    `Occupation: ${p.occupation ?? '—'}`,
    `Passport number: ${p.passportNumber ?? '—'}`,
    `Passport country: ${p.passportCountry ?? '—'}`,
  ].join('\n');
}

function formatFormerPartner(p: InzData['formerPartners'][number]): string {
  return [
    `Full name: ${p.fullName}`,
    `Date of birth: ${formatDateOrNull(p.dateOfBirth) ?? '—'}`,
    `Relationship status: ${p.relationshipStatus ?? '—'}`,
    `Country of birth: ${p.countryOfBirth ?? '—'}`,
    `Nationality: ${p.nationality ?? '—'}`,
  ].join('\n');
}

function formatChild(c: InzData['children'][number]): string {
  return [
    `Full name: ${c.fullName}`,
    `Date of birth: ${formatDateOrNull(c.dateOfBirth) ?? '—'}`,
    `Country of birth: ${c.countryOfBirth ?? '—'}`,
    `Nationality: ${c.nationality ?? '—'}`,
    `Lives with applicant: ${yesno(c.livesWithApplicant) ?? '—'}`,
  ].join('\n');
}

function formatParent(p: InzData['parents'][number]): string {
  return [
    `Full name: ${p.fullName}`,
    `Relationship: ${p.relationshipToApplicant ?? '—'}`,
    `Deceased: ${yesno(p.isDeceased) ?? '—'}`,
    `Date of birth: ${formatDateOrNull(p.dateOfBirth) ?? '—'}`,
    `Country of residence: ${p.countryOfResidence ?? '—'}`,
    `Occupation: ${p.occupation ?? '—'}`,
  ].join('\n');
}

function formatSibling(s: InzData['siblings'][number]): string {
  return [
    `Full name: ${s.fullName}`,
    `Relationship: ${s.relationshipToApplicant ?? '—'}`,
    `Date of birth: ${formatDateOrNull(s.dateOfBirth) ?? '—'}`,
    `Country of residence: ${s.countryOfResidence ?? '—'}`,
    `Occupation: ${s.occupation ?? '—'}`,
  ].join('\n');
}

function formatNzContact(c: InzData['nzContacts'][number]): string {
  return [
    `Full name: ${c.fullName}`,
    `Relationship: ${c.relationshipToApplicant ?? '—'}`,
    `Phone: ${c.phone ?? '—'}`,
    `Email: ${c.email ?? '—'}`,
    `Street: ${c.street ?? '—'}`,
    `Suburb: ${c.suburb ?? '—'}`,
    `Town / City: ${c.townCity ?? '—'}`,
    `Region: ${c.region ?? '—'}`,
    `Postcode: ${c.postcode ?? '—'}`,
  ].join('\n');
}

function formatMilitary(m: NonNullable<InzData['militaryHistory']>): string {
  const head = [
    'Military history',
    '',
    `Ever undertaken military service: ${yesno(m.everUndertakenMilitaryService) ?? '—'}`,
    `Compulsory in home country: ${yesno(m.militaryServiceCompulsoryHome) ?? '—'}`,
    `Exempt: ${yesno(m.wasExemptFromMilitaryService) ?? '—'}`,
    `Exemption explanation: ${m.exemptExplanation ?? '—'}`,
  ].join('\n');
  if (m.services.length === 0) return head;
  return `${head}\n\n${m.services.map(s => formatMilitaryService(s)).join('\n\n')}`;
}

function formatMilitaryService(s: NonNullable<InzData['militaryHistory']>['services'][number]): string {
  return [
    `Started: ${formatDateOrNull(s.dateStarted) ?? '—'}`,
    `Finished: ${formatDateOrNull(s.dateFinished) ?? '—'}`,
    `Location: ${s.location ?? '—'}`,
    `Corps: ${s.corps ?? '—'}`,
    `Rank: ${s.rank ?? '—'}`,
    `Commanding officer: ${s.commandingOfficer ?? '—'}`,
    `Duties: ${s.duties ?? '—'}`,
  ].join('\n');
}

function formatTravel(t: InzData['travelHistory'][number]): string {
  return [
    `Destination: ${t.destination}`,
    `Entered: ${joinMonthYear(t.dateEnteredMonth, t.dateEnteredYear) ?? '—'}`,
    `Exited: ${joinMonthYear(t.dateExitedMonth, t.dateExitedYear) ?? '—'}`,
    `Arrival mode: ${t.arrivalMode ?? '—'}`,
    `Point of entry: ${t.pointOfEntry ?? '—'}`,
    `Purpose: ${t.purposeOfTravel ?? '—'}`,
    `Other purpose: ${t.otherPurpose ?? '—'}`,
  ].join('\n');
}

function formatAssistance(a: NonNullable<InzData['immigrationAssistance']>): string {
  return [
    `Completed on behalf: ${yesno(a.completingOnBehalf) ?? '—'}`,
    `Capacity: ${a.capacity ?? '—'}`,
    `Adviser full name: ${a.adviserFullName ?? '—'}`,
    `Adviser number: ${a.adviserNumber ?? '—'}`,
    `Adviser email: ${a.adviserEmail ?? '—'}`,
    `Adviser contact: ${a.adviserContactNumber ?? '—'}`,
    `Adviser is primary contact: ${yesno(a.adviserIsPrimaryContact) ?? '—'}`,
  ].join('\n');
}

function serialiseEntire(d: InzData): string {
  const parts: string[] = [];
  parts.push(serialiseApplicant(d.applicant));
  parts.push(serialiseList('Other citizenships', d.citizenships.map(c => `Country: ${c.country}\nHolds passport: ${yesno(c.holdsPassport) ?? '—'}`)));
  parts.push(serialiseList('TB countries', d.tbCountries.map(c => `Country: ${c.country}\nDuration (days): ${c.totalDurationDays ?? '—'}`)));
  parts.push(serialiseList('Education entries', d.educationEntries.map(e => formatEducation(e))));
  parts.push(serialiseList('Employment history', d.employmentEntries.map(e => formatEmployment(e))));
  parts.push(serialiseList('Unemployment periods', d.unemploymentEntries.map(u => formatUnemployment(u))));
  parts.push(d.partner ? `Partner\n\n${formatPartner(d.partner)}` : 'Partner\n\n(none recorded)');
  parts.push(serialiseList('Former partners', d.formerPartners.map(p => formatFormerPartner(p))));
  parts.push(serialiseList('Children', d.children.map(c => formatChild(c))));
  parts.push(serialiseList('Parents', d.parents.map(p => formatParent(p))));
  parts.push(serialiseList('Siblings', d.siblings.map(s => formatSibling(s))));
  parts.push(serialiseList('NZ contacts', d.nzContacts.map(c => formatNzContact(c))));
  parts.push(d.militaryHistory ? formatMilitary(d.militaryHistory) : 'Military history\n\n(none recorded)');
  parts.push(serialiseList('Travel history', d.travelHistory.map(t => formatTravel(t))));
  parts.push(d.immigrationAssistance ? `Immigration assistance\n\n${formatAssistance(d.immigrationAssistance)}` : 'Immigration assistance\n\n(none recorded)');
  parts.push(serialiseList('Supporting documents', d.supportingDocuments.map(doc => `Type: ${doc.docType}\nFilename: ${doc.fileName}`)));
  return parts.join('\n\n══════════════════════════════════════\n\n');
}
