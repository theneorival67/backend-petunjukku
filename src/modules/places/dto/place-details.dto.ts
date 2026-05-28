import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class PlaceDetailsDto {
  @ApiProperty({ example: 'ChIJN1t_tDeuEmsRUsoyG83frY4' })
  placeId: string;

  @ApiProperty({ example: 'SMA Negeri 1 Surabaya' })
  name: string;

  @ApiPropertyOptional({ example: 'Surabaya' })
  city?: string;

  @ApiPropertyOptional({ example: 'Jawa Timur' })
  province?: string;

  @ApiPropertyOptional({ example: 'Genteng' })
  district?: string;

  @ApiPropertyOptional({
    example: 'Jl. Contoh No. 1, Surabaya, Jawa Timur, Indonesia',
  })
  address?: string;

  @ApiPropertyOptional({ example: -7.2575 })
  latitude?: number;

  @ApiPropertyOptional({ example: 112.7521 })
  longitude?: number;
}
