export function sanitizeString(input: string): string {
  if (!input || typeof input !== 'string') return input;
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;')
    .replace(/\\/g, '&#x5C;')
    .trim();
}

export function normalizePhone(phone: string): string {
  if (!phone) return phone;
  return phone.replace(/[\s\-\(\)]/g, '').trim();
}
