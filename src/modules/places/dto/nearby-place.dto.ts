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
    description: 'ID kategori stabil untuk grouping UI dan konteks AI',
    example: 'umkm-ekonomi',
  })
  categoryId!: string;

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

export class EnvironmentRiskDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty({
    description: 'RENDAH | SEDANG | TINGGI',
  })
  level!: string;

  @ApiProperty()
  description!: string;

  @ApiPropertyOptional({
    description: 'Titik sekitar yang menjadi dasar sinyal risiko',
  })
  evidence?: string[];
}

export class EnvironmentCategoryGroupDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  label!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty()
  colorKey!: string;

  @ApiProperty()
  placeCount!: number;

  @ApiProperty({ type: String, isArray: true })
  learningUses!: string[];

  @ApiProperty({ type: NearbyPlaceDto, isArray: true })
  places!: NearbyPlaceDto[];
}

export class EnvironmentScanDto {
  @ApiProperty({ type: NearbyPlaceDto, isArray: true })
  places!: NearbyPlaceDto[];

  @ApiProperty({ type: EnvironmentCategoryGroupDto, isArray: true })
  categoryGroups!: EnvironmentCategoryGroupDto[];

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
      'google_places | google_places_ai_service (jika kurasi AI aktif)',
  })
  source!: string;

  @ApiProperty({ type: EnvironmentRiskDto, isArray: true })
  risks!: EnvironmentRiskDto[];

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
