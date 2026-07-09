import { registerDecorator, ValidationOptions } from 'class-validator';
import { isValidLanguageCode } from '../language-codes';

// Phase 2b — shared per-element ISO 639-1 validator decorator.
//
// Extracted from Phase 2a's team.dto so both the staff-languages DTO
// (User.languages, array — used with `{ each: true }`) and the client
// intake DTO (Contact.preferredLanguage, single value) validate against
// the SAME lowercase ISO 639-1 set (common/language-codes.ts). Keeping
// client + staff on one format is what makes consultant language-matching
// comparable.
//
// Mirrors the IsCountryCode pattern in staff-users.dto.ts. Rejects display
// names ("English", "Farsi") and uppercase codes — only 'en', 'fa', … pass.
export function IsLanguageCode(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isLanguageCode',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          return isValidLanguageCode(value);
        },
        defaultMessage() {
          return `${propertyName} must be a valid ISO 639-1 language code (lowercase, e.g. "en", "fa")`;
        },
      },
    });
  };
}
