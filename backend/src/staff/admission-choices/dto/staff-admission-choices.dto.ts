import { IsArray, IsInt, IsString, Max, Min } from 'class-validator';

// PR-ADMISSION-SHARED — DTOs for the Admission Officer's programme-choice CRUD.

export class StaffAddChoiceDto {
  @IsString() programmeId!: string;
  @IsInt() @Min(1) @Max(12) intakeMonth!: number;
  @IsInt() @Min(2025) @Max(2100) intakeYear!: number;
}

export class StaffReorderChoicesDto {
  @IsArray() @IsString({ each: true }) orderedIds!: string[];
}
