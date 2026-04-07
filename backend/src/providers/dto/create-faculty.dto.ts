import { IsNotEmpty, IsString } from 'class-validator';

export class CreateFacultyDto {
  @IsString()
  @IsNotEmpty()
  name: string;
}
