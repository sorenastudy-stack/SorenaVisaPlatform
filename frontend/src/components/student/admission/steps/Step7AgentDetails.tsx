'use client';

import { useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useAdmission } from '../AdmissionFormContext';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

export function Step7AgentDetails() {
  const t = useTranslations();
  const { step7Fields, setStep7Fields, patchApplication, registerStepHandler } = useAdmission();
  const {
    counsellorFirstName, counsellorLastName, counsellorEmail,
    anotherBranch, branchAgentCode, branchName,
    agentDeclarationAgreed, agentComments,
  } = step7Fields;

  const handler = useCallback(async (): Promise<boolean> => {
    if (!counsellorFirstName?.trim()) {
      toast.error(t('admissionStep7ValidationCounsellorFirstName'));
      return false;
    }
    if (!counsellorLastName?.trim()) {
      toast.error(t('admissionStep7ValidationCounsellorLastName'));
      return false;
    }
    if (!counsellorEmail?.trim()) {
      toast.error(t('admissionStep7ValidationCounsellorEmail'));
      return false;
    }
    if (!EMAIL_RE.test(counsellorEmail.trim())) {
      toast.error(t('admissionStep7ValidationCounsellorEmailFormat'));
      return false;
    }
    if (anotherBranch === null) {
      toast.error(t('admissionStep7ValidationAnotherBranch'));
      return false;
    }
    if (anotherBranch === true) {
      if (!branchAgentCode?.trim()) {
        toast.error(t('admissionStep7ValidationBranchAgentCode'));
        return false;
      }
      if (!branchName?.trim()) {
        toast.error(t('admissionStep7ValidationBranchName'));
        return false;
      }
    }
    if (agentDeclarationAgreed !== true) {
      toast.error(t('admissionStep7ValidationDeclaration'));
      return false;
    }
    try {
      const patchBody: Record<string, unknown> = {
        counsellorFirstName: counsellorFirstName.trim(),
        counsellorLastName: counsellorLastName.trim(),
        counsellorEmail: counsellorEmail.trim(),
        anotherBranch,
        agentDeclarationAgreed,
      };
      if (anotherBranch === true) {
        patchBody.branchAgentCode = branchAgentCode!.trim();
        patchBody.branchName = branchName!.trim();
      } else {
        // "No other branch" — clear any previously saved branch rows.
        patchBody.branchAgentCode = null;
        patchBody.branchName = null;
      }
      if (agentComments?.trim()) {
        patchBody.agentComments = agentComments.trim();
      }
      await patchApplication(patchBody);
      return true;
    } catch {
      return false;
    }
  }, [
    counsellorFirstName, counsellorLastName, counsellorEmail,
    anotherBranch, branchAgentCode, branchName,
    agentDeclarationAgreed, agentComments,
    patchApplication, t,
  ]);

  useEffect(() => {
    registerStepHandler(handler);
    return () => registerStepHandler(null);
  }, [handler, registerStepHandler]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-sorena-navy">{t('admissionStep7Title')}</h2>
        <p className="mt-1 text-sm text-sorena-navy/60">{t('admissionStep7Helper')}</p>
      </div>

      {/* counsellorFirstName */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep7CounsellorFirstNameLabel')}
          <span className="ml-0.5 text-red-500">*</span>
        </label>
        <input
          type="text"
          value={counsellorFirstName ?? ''}
          onChange={(e) => setStep7Fields({ counsellorFirstName: e.target.value })}
          placeholder={t('admissionStep7CounsellorFirstNamePlaceholder')}
          className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
        />
      </div>

      {/* counsellorLastName */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep7CounsellorLastNameLabel')}
          <span className="ml-0.5 text-red-500">*</span>
        </label>
        <input
          type="text"
          value={counsellorLastName ?? ''}
          onChange={(e) => setStep7Fields({ counsellorLastName: e.target.value })}
          placeholder={t('admissionStep7CounsellorLastNamePlaceholder')}
          className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
        />
      </div>

      {/* counsellorEmail */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep7CounsellorEmailLabel')}
          <span className="ml-0.5 text-red-500">*</span>
        </label>
        <input
          type="email"
          value={counsellorEmail ?? ''}
          onChange={(e) => setStep7Fields({ counsellorEmail: e.target.value })}
          placeholder={t('admissionStep7CounsellorEmailPlaceholder')}
          className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
        />
      </div>

      {/* anotherBranch — Y/N pill question */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep7AnotherBranchLabel')}
          <span className="ml-0.5 text-red-500">*</span>
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStep7Fields({ anotherBranch: true })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              anotherBranch === true
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep3Question1OptionYes')}
          </button>
          <button
            type="button"
            onClick={() => setStep7Fields({ anotherBranch: false })}
            className={[
              'rounded-lg border px-5 py-2 text-base font-medium transition-colors',
              anotherBranch === false
                ? 'border-sorena-navy bg-sorena-navy text-white'
                : 'border-sorena-navy/20 text-sorena-navy hover:bg-sorena-navy/5',
            ].join(' ')}
          >
            {t('admissionStep3Question1OptionNo')}
          </button>
        </div>
      </div>

      {/* Conditional branch fields when anotherBranch === true */}
      {anotherBranch === true && (
        <>
          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('admissionStep7BranchAgentCodeLabel')}
              <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="text"
              value={branchAgentCode ?? ''}
              onChange={(e) => setStep7Fields({ branchAgentCode: e.target.value })}
              placeholder={t('admissionStep7BranchAgentCodePlaceholder')}
              className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
              {t('admissionStep7BranchNameLabel')}
              <span className="ml-0.5 text-red-500">*</span>
            </label>
            <input
              type="text"
              value={branchName ?? ''}
              onChange={(e) => setStep7Fields({ branchName: e.target.value })}
              placeholder={t('admissionStep7BranchNamePlaceholder')}
              className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
            />
          </div>
        </>
      )}

      {/* Declaration subsection */}
      <div className="mt-4 border-t border-sorena-navy/10 pt-6">
        <h3 className="text-xl font-bold text-sorena-navy">{t('admissionStep7DeclarationSectionTitle')}</h3>
      </div>

      {/* agentDeclarationAgreed — checkbox + declaration text */}
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={agentDeclarationAgreed === true}
          onChange={(e) => setStep7Fields({ agentDeclarationAgreed: e.target.checked })}
          className="mt-1 h-4 w-4 shrink-0 cursor-pointer rounded border-sorena-navy/20 accent-sorena-navy"
        />
        <span className="text-sm text-sorena-navy/80">
          {t('admissionStep7DeclarationText')}
          <span className="ml-0.5 text-red-500">*</span>
        </span>
      </label>

      {/* agentComments — optional textarea */}
      <div>
        <label className="mb-1.5 block text-sm font-bold uppercase tracking-wide text-sorena-navy">
          {t('admissionStep7CommentsLabel')}
        </label>
        <textarea
          rows={4}
          value={agentComments ?? ''}
          onChange={(e) => setStep7Fields({ agentComments: e.target.value })}
          placeholder={t('admissionStep7CommentsPlaceholder')}
          className="w-full rounded-lg border border-sorena-navy/20 bg-white px-3 py-2.5 text-sm text-sorena-navy placeholder:text-sorena-navy/40 focus:border-sorena-navy/60 focus:outline-none"
        />
      </div>
    </div>
  );
}
