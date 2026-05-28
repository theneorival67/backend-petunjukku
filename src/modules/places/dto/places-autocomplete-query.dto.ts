import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class PlacesAutocompleteQueryDto {
  @ApiProperty({
    example: 'SMA Negeri 1 Surabaya',
    description: 'Teks pencarian sekolah',
    minLength: 2,
    maxLength: 200,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  input: string;

  @ApiPropertyOptional({
    description:
      'Token sesi Google Places (opsional, untuk billing session-based)',
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sessionToken?: string;
}
