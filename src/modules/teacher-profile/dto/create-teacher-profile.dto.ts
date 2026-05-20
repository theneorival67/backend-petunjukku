import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateTeacherProfileDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName: string;

  @IsOptional()
  @IsUUID()
  schoolId?: string;

  /** Nama sekolah — dibuat/dicari otomatis jika schoolId tidak ada */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  schoolName?: string;
}
