// Single source of truth for "Sorena as the education agent". The Visa
// Section's Step 3 ("Eligibility") pre-fills these into the read-only
// Education-agent-details block whenever the student answers Yes to
// "Did you use an education agent...". Update here when any of these
// values change — the form will follow on the next render and the
// updated values get written to every subsequent save.
export const SORENA_AGENT_DETAILS = {
  organisationName: 'Sorena Visa',
  country:          'NZ',
  givenName:        'Yashua',
  surname:          'Arjmand',
  email:            'admission@sorenavisa.com',
} as const;
