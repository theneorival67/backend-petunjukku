import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class NearbyPlaceDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'Jarak format manusia, mis. 350 m atau 1.2 km' })
  distanceLabel!: string;

  @ApiProperty()
  distanceMeters!: number;

  @ApiProperty({
    description: 'Kategori pedagogis',
    example: 'Ruang terbuka hijau',
  })
  category!: string;

  @ApiProperty({
    description: 'Kunci warna untuk UI',
    example: 'emerald',
  })
  colorKey!: string;

  @ApiPropertyOptional({
    description: 'Catatan singkat relevansi untuk konteks pembelajaran',
  })
  relevanceNote?: string;

  @ApiProperty({ description: 'Skor relevansi 0–100 (kurasi server)' })
  relevanceScore!: number;
}

export class EnvironmentScanDto {
  @ApiProperty({ type: NearbyPlaceDto, isArray: true })
  places!: NearbyPlaceDto[];

  @ApiProperty({
    description: 'Ringkasan hasil pemindaian untuk guru/AI',
  })
  summary!: string;

  @ApiProperty()
  schoolLatitude!: number;

  @ApiProperty()
  schoolLongitude!: number;

  @ApiProperty()
  radiusMeters!: number;

  @ApiProperty({
    description:
      'google_places | google_places_opencode_go (jika kurasi AI aktif)',
  })
  source!: string;

  @ApiPropertyOptional({
    description: 'True jika hasil dikembalikan dari cache database',
  })
  cached?: boolean;

  @ApiPropertyOptional({
    description: 'Waktu data lingkungan terakhir diambil dari Google Maps',
  })
  fetchedAt?: string;

  @ApiPropertyOptional({
    description: 'Batas waktu cache dianggap fresh',
  })
  expiresAt?: string;
}
