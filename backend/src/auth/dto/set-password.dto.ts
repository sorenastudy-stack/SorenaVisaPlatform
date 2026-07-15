import { IsEmail, IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

// Client-onboarding first-time password creation. Strength rules live ONLY
// here (the new endpoint) — staff /auth/register is intentionally untouched.
// Min 10 chars, at least one letter AND one digit.
export class SetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters long.' })
  @Matches(/[A-Za-z]/, { message: 'Password must include at least one letter.' })
  @Matches(/[0-9]/, { message: 'Password must include at least one number.' })
  password: string;
}
