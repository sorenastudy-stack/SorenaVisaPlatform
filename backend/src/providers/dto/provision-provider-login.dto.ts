import { IsEmail, MaxLength } from 'class-validator';

// PR-PROVIDER-PORTAL slice B — the address the institution's magic links go to.
export class ProvisionProviderLoginDto {
  @IsEmail({}, { message: 'A valid email address is required for the login.' })
  @MaxLength(200)
  email!: string;
}
