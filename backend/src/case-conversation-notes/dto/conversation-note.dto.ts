import { IsString, MaxLength } from 'class-validator';

// PR-LIA-CONVO-NOTES — DTOs for LIA conversation notes.
//
// `body` is rich-text HTML from the shared editor. We DON'T enforce a MinLength
// here: raw HTML length is a poor proxy for content ("<p>Hi</p>" is 9 chars of
// markup). The real "is there any content?" check happens AFTER server-side
// sanitizing, in the service (isEffectivelyEmpty). MaxLength is a coarse abuse
// guard on the wire — markup overhead means it's generous relative to the ~5000
// visible-character budget the editor targets.

const MAX_BODY_HTML = 20_000;

export class CreateConversationNoteDto {
  @IsString()
  @MaxLength(MAX_BODY_HTML)
  body!: string;
}

export class UpdateConversationNoteDto {
  @IsString()
  @MaxLength(MAX_BODY_HTML)
  body!: string;
}
