import { IsEmail, IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

// Phase F — staff password RESET (consume token + set new password).
// Strength rules MATCH the first-time set-password flow (set-password.dto.ts):
// min 10 chars, ≥1 letter, ≥1 number. Do not diverge.
export class ResetPasswordDto {
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

// Phase F — signed-in staff CHANGE password. Current password mandatory; new
// password uses the same strength rule as every other password entry point.
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'Your current password is required.' })
  currentPassword: string;

  @IsString()
  @MinLength(10, { message: 'Password must be at least 10 characters long.' })
  @Matches(/[A-Za-z]/, { message: 'Password must include at least one letter.' })
  @Matches(/[0-9]/, { message: 'Password must include at least one number.' })
  newPassword: string;
}
