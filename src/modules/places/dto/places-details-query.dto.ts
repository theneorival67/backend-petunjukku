import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class PlacesDetailsQueryDto {
  @ApiProperty({
    example: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
    description: 'placeId dari hasil autocomplete',
  })
  @IsString()
  @MinLength(10)
  @MaxLength(300)
  placeId: string;
}
