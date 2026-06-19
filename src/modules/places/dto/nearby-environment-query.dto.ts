import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBooleanString,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class NearbyEnvironmentQueryDto {
  @ApiPropertyOptional({ description: 'Lintang pusat (sekolah)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ description: 'Bujur pusat (sekolah)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional({
    description: 'Google Place ID sekolah (jika koordinat belum ada)',
  })
  @IsOptional()
  @IsString()
  placeId?: string;

  @ApiPropertyOptional({
    description: 'Radius pencarian dalam meter',
    default: 5000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(200)
  @Max(5000)
  radiusMeters?: number;

  @ApiPropertyOptional({ description: 'Nama sekolah untuk ringkasan' })
  @IsOptional()
  @IsString()
  schoolName?: string;

  @ApiPropertyOptional({
    description: 'Lewati cache dan ambil ulang dari Google Maps',
    default: false,
  })
  @IsOptional()
  @IsBooleanString()
  refresh?: string;
}

export class StaticMapQueryDto {
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiPropertyOptional({ default: 640 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(200)
  @Max(1280)
  width?: number;

  @ApiPropertyOptional({ default: 360 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(200)
  @Max(1280)
  height?: number;
}
