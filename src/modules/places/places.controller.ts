import {
  Controller,
  Get,
  Header,
  Query,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiTags,
} from '@nestjs/swagger';
import { EnvironmentScanDto } from './dto/nearby-place.dto';
import {
  NearbyEnvironmentQueryDto,
  StaticMapQueryDto,
} from './dto/nearby-environment-query.dto';
import { PlaceDetailsDto } from './dto/place-details.dto';
import { PlaceSuggestionDto } from './dto/place-suggestion.dto';
import { PlacesAutocompleteQueryDto } from './dto/places-autocomplete-query.dto';
import { PlacesDetailsQueryDto } from './dto/places-details-query.dto';
import { PlacesService } from './places.service';

@ApiTags('places')
@ApiBearerAuth('supabase')
@Controller('places')
export class PlacesController {
  constructor(private readonly placesService: PlacesService) {}

  @Get('autocomplete')
  @ApiOperation({
    summary: 'Cari sekolah (Google Places proxy)',
    description:
      'Mengembalikan daftar saran sekolah di Indonesia. Memerlukan Bearer token Supabase.',
  })
  @ApiOkResponse({ type: PlaceSuggestionDto, isArray: true })
  autocomplete(@Query() query: PlacesAutocompleteQueryDto) {
    return this.placesService.autocomplete(query.input, query.sessionToken);
  }

  @Get('details')
  @ApiOperation({
    summary: 'Detail sekolah untuk autofill',
    description:
      'Mengambil nama, kota, provinsi, dan alamat dari Google Places berdasarkan placeId.',
  })
  @ApiOkResponse({ type: PlaceDetailsDto })
  details(@Query() query: PlacesDetailsQueryDto) {
    return this.placesService.getPlaceDetails(query.placeId);
  }

  @Get('nearby-environment')
  @ApiOperation({
    summary: 'Pemindai lingkungan sekitar sekolah',
    description:
      'Mengambil titik penting dari Google Places lalu mengurasi relevansi pedagogis untuk konteks RPP.',
  })
  @ApiOkResponse({ type: EnvironmentScanDto })
  nearbyEnvironment(@Query() query: NearbyEnvironmentQueryDto) {
    return this.placesService.scanNearbyEnvironment({
      latitude: query.latitude,
      longitude: query.longitude,
      placeId: query.placeId,
      radiusMeters: query.radiusMeters,
      schoolName: query.schoolName,
      forceRefresh: query.refresh === 'true',
    });
  }

  @Get('static-map')
  @ApiOperation({
    summary: 'Pratinjau peta statis sekolah (proxy Google Static Maps)',
  })
  @ApiProduces('image/png')
  @Header('Cache-Control', 'no-store')
  async staticMap(@Query() query: StaticMapQueryDto) {
    const buffer = await this.placesService.fetchStaticMapBuffer({
      latitude: query.latitude,
      longitude: query.longitude,
      width: query.width,
      height: query.height,
    });

    return new StreamableFile(buffer, { type: 'image/png' });
  }
}
