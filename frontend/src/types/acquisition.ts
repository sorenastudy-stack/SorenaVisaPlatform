export interface CreateLeadPayload {
  fullName: string;
  email?: string;
  phone?: string;
  whatsapp?: string;
  destination: 'NZ';
  studyLevel?: string;
  preferredLanguage?: string;
  privacyConsent: boolean;
  marketingConsent?: boolean;
  visitorId?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrer?: string;
  landingPage?: string;
  website?: string;
}

export interface LeadResponse {
  id: string;
  status: string;
  emailVerificationRequired: boolean;
  message: string;
}

export interface VerifyEmailResponse {
  message: string;
  alreadyVerified: boolean;
  name?: string;
}
