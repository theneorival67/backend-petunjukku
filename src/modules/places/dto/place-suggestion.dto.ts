import { ApiProperty } from '@nestjs/swagger';

export class PlaceSuggestionDto {
  @ApiProperty({
    example: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
    description: 'ID tempat Google Places',
  })
  placeId: string;

  @ApiProperty({ example: 'SMA Negeri 1 Surabaya' })
  primaryText: string;

  @ApiProperty({ example: 'Surabaya, Jawa Timur, Indonesia' })
  secondaryText: string;
}
