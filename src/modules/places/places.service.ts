import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AiService } from '../ai/ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import { type RawNearbyPlace } from './environment-curate';
import type { EnvironmentScanDto } from './dto/nearby-place.dto';
import type { PlaceDetailsDto } from './dto/place-details.dto';
import type { PlaceSuggestionDto } from './dto/place-suggestion.dto';

type GoogleAddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

type GoogleAutocompleteResponse = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      text?: { text?: string };
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
    };
  }>;
};

type GooglePlaceDetailsResponse = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
  location?: { latitude?: number; longitude?: number };
};

type GoogleNearbySearchResponse = {
  places?: Array<{
    id?: string;
    displayName?: { text?: string };
    location?: { latitude?: number; longitude?: number };
    types?: string[];
    primaryType?: string;
  }>;
};

type StaticMapCacheEntry = {
  buffer: Buffer;
  expiresAt: number;
};

@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);
  private readonly apiKey: string;
  private readonly staticMapCache = new Map<string, StaticMapCacheEntry>();
  private readonly staticMapCacheTtlMs = 6 * 60 * 60 * 1000;
  private readonly environmentCacheTtlMs = 7 * 24 * 60 * 60 * 1000;
  private readonly environmentCacheMaxStaleMs = 30 * 24 * 60 * 60 * 1000;
  private readonly environmentRefreshInFlight = new Set<string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly aiService: AiService,
    private readonly prisma: PrismaService,
  ) {
    this.apiKey =
      this.configService.get<string>('googleMaps.apiKey', { infer: true }) ??
      '';
  }

  private assertConfigured() {
    if (!this.apiKey) {
      throw new ServiceUnavailableException(
        'GOOGLE_MAPS_API_KEY belum dikonfigurasi di server.',
      );
    }
  }

  async autocomplete(
    input: string,
    sessionToken?: string,
  ): Promise<PlaceSuggestionDto[]> {
    this.assertConfigured();

    const body: Record<string, unknown> = {
      input: input.trim(),
      includedRegionCodes: ['id'],
      includedPrimaryTypes: [
        'school',
        'primary_school',
        'secondary_school',
        'university',
      ],
      languageCode: 'id',
    };

    if (sessionToken?.trim()) {
      body.sessionToken = sessionToken.trim();
    }

    const res = await fetch(
      'https://places.googleapis.com/v1/places:autocomplete',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
        },
        body: JSON.stringify(body),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new BadGatewayException(
        `Google Places autocomplete gagal (${res.status})${errText ? `: ${errText.slice(0, 200)}` : ''}`,
      );
    }

    const data = (await res.json()) as GoogleAutocompleteResponse;

    return (data.suggestions ?? [])
      .map((item) => {
        const prediction = item.placePrediction;
        if (!prediction?.placeId) {
          return null;
        }

        const primaryText =
          prediction.structuredFormat?.mainText?.text ??
          prediction.text?.text ??
          '';
        const secondaryText =
          prediction.structuredFormat?.secondaryText?.text ?? '';

        if (!primaryText) {
          return null;
        }

        return {
          placeId: prediction.placeId,
          primaryText,
          secondaryText,
        };
      })
      .filter((item): item is PlaceSuggestionDto => item !== null);
  }

  async getPlaceDetails(placeId: string): Promise<PlaceDetailsDto> {
    this.assertConfigured();

    const resource = placeId.startsWith('places/')
      ? placeId
      : `places/${placeId}`;

    const res = await fetch(
      `https://places.googleapis.com/v1/${encodeURI(resource)}`,
      {
        headers: {
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask':
            'id,displayName,formattedAddress,addressComponents,location',
        },
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new BadGatewayException(
        `Google Places details gagal (${res.status})${errText ? `: ${errText.slice(0, 200)}` : ''}`,
      );
    }

    const data = (await res.json()) as GooglePlaceDetailsResponse;
    const parsed = this.parseAddressComponents(data.addressComponents ?? []);

    return {
      placeId: data.id ?? placeId,
      name: data.displayName?.text?.trim() ?? '',
      city: parsed.city || undefined,
      province: parsed.province || undefined,
      district: parsed.district || undefined,
      address: data.formattedAddress?.trim() || undefined,
      latitude: data.location?.latitude,
      longitude: data.location?.longitude,
    };
  }

  private parseAddressComponents(components: GoogleAddressComponent[]) {
    const find = (...types: string[]) =>
      components.find((c) =>
        types.some((type) => c.types?.includes(type)),
      );

    const province =
      find('administrative_area_level_1')?.longText?.trim() ?? '';
    const city =
      find('locality')?.longText?.trim() ??
      find('administrative_area_level_2')?.longText?.trim() ??
      '';
    const district =
      find('administrative_area_level_3')?.longText?.trim() ??
      find('sublocality_level_1')?.longText?.trim() ??
      '';

    return { province, city, district };
  }

  async scanNearbyEnvironment(input: {
    latitude?: number;
    longitude?: number;
    placeId?: string;
    radiusMeters?: number;
    schoolName?: string;
    forceRefresh?: boolean;
  }): Promise<EnvironmentScanDto> {
    this.assertConfigured();

    const radiusMeters = input.radiusMeters ?? 2000;
    let latitude = input.latitude;
    let longitude = input.longitude;

    if (
      (latitude === undefined || longitude === undefined) &&
      input.placeId?.trim()
    ) {
      const details = await this.getPlaceDetails(input.placeId.trim());
      latitude = details.latitude;
      longitude = details.longitude;
    }

    if (latitude === undefined || longitude === undefined) {
      throw new BadRequestException(
        'Koordinat sekolah belum tersedia. Lengkapi lokasi sekolah di onboarding atau Konteks mengajar.',
      );
    }

    const cacheKey = this.environmentCacheKey({
      latitude,
      longitude,
      radiusMeters,
      placeId: input.placeId,
      schoolName: input.schoolName,
    });
    const cached = await this.prisma.schoolEnvironmentScan.findUnique({
      where: { cacheKey },
    });
    const cachedScan = cached
      ? this.parseEnvironmentCachePayload(cached.payload)
      : null;
    const now = new Date();

    if (!input.forceRefresh && cached && cachedScan) {
      const isFresh = cached.expiresAt > now;
      const isAllowedStale =
        now.getTime() - cached.fetchedAt.getTime() <=
        this.environmentCacheMaxStaleMs;

      if (isFresh) {
        return this.withCacheMetadata(cachedScan, cached, true);
      }

      if (isAllowedStale) {
        void this.refreshEnvironmentCacheOnce(cacheKey, {
          latitude,
          longitude,
          radiusMeters,
          schoolName: input.schoolName,
        });
        return this.withCacheMetadata(cachedScan, cached, true);
      }
    }

    try {
      return await this.refreshEnvironmentCache(cacheKey, {
        latitude,
        longitude,
        radiusMeters,
        schoolName: input.schoolName,
      });
    } catch (error) {
      if (cached && cachedScan) {
        this.logger.warn(
          `Refresh pemindai lingkungan gagal, memakai cache lama: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return this.withCacheMetadata(cachedScan, cached, true);
      }
      throw error;
    }
  }

  private async refreshEnvironmentCacheOnce(
    cacheKey: string,
    input: {
      latitude: number;
      longitude: number;
      radiusMeters: number;
      schoolName?: string;
    },
  ) {
    if (this.environmentRefreshInFlight.has(cacheKey)) {
      return;
    }
    this.environmentRefreshInFlight.add(cacheKey);
    try {
      await this.refreshEnvironmentCache(cacheKey, input);
    } catch (error) {
      this.logger.warn(
        `Refresh background pemindai lingkungan gagal: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    } finally {
      this.environmentRefreshInFlight.delete(cacheKey);
    }
  }

  private async refreshEnvironmentCache(
    cacheKey: string,
    input: {
      latitude: number;
      longitude: number;
      radiusMeters: number;
      schoolName?: string;
    },
  ): Promise<EnvironmentScanDto> {
    const rawPlaces = await this.fetchNearbyFromGoogle(
      input.latitude,
      input.longitude,
      input.radiusMeters,
    );

    const curated = await this.aiService.curateSchoolEnvironment({
      schoolName: input.schoolName,
      latitude: input.latitude,
      longitude: input.longitude,
      radiusMeters: input.radiusMeters,
      rawPlaces,
    });

    const payload: EnvironmentScanDto = {
      places: curated.places,
      summary: curated.summary,
      schoolLatitude: input.latitude,
      schoolLongitude: input.longitude,
      radiusMeters: input.radiusMeters,
      source: curated.usedAi ? 'google_places_opencode_go' : 'google_places',
    };
    const fetchedAt = new Date();
    const expiresAt = new Date(
      fetchedAt.getTime() + this.environmentCacheTtlMs,
    );
    const cached = await this.prisma.schoolEnvironmentScan.upsert({
      where: { cacheKey },
      create: {
        cacheKey,
        latitude: input.latitude,
        longitude: input.longitude,
        radiusMeters: input.radiusMeters,
        payload: payload as unknown as Prisma.InputJsonValue,
        source: payload.source,
        fetchedAt,
        expiresAt,
      },
      update: {
        latitude: input.latitude,
        longitude: input.longitude,
        radiusMeters: input.radiusMeters,
        payload: payload as unknown as Prisma.InputJsonValue,
        source: payload.source,
        fetchedAt,
        expiresAt,
      },
    });

    return this.withCacheMetadata(payload, cached, false);
  }

  private environmentCacheKey(input: {
    latitude: number;
    longitude: number;
    radiusMeters: number;
    placeId?: string;
    schoolName?: string;
  }): string {
    const place =
      input.placeId?.trim().toLowerCase() ||
      `${input.latitude.toFixed(6)},${input.longitude.toFixed(6)}`;
    const school = input.schoolName?.trim().toLowerCase() || 'school';
    return ['environment-v1', place, input.radiusMeters, school].join(':');
  }

  private parseEnvironmentCachePayload(
    payload: Prisma.JsonValue,
  ): EnvironmentScanDto | null {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }

    const record = payload as Record<string, unknown>;
    if (
      !Array.isArray(record.places) ||
      typeof record.summary !== 'string' ||
      typeof record.schoolLatitude !== 'number' ||
      typeof record.schoolLongitude !== 'number' ||
      typeof record.radiusMeters !== 'number' ||
      typeof record.source !== 'string'
    ) {
      return null;
    }

    return {
      places: record.places as EnvironmentScanDto['places'],
      summary: record.summary,
      schoolLatitude: record.schoolLatitude,
      schoolLongitude: record.schoolLongitude,
      radiusMeters: record.radiusMeters,
      source: record.source,
    };
  }

  private withCacheMetadata(
    scan: EnvironmentScanDto,
    cached: {
      fetchedAt: Date;
      expiresAt: Date;
    },
    fromCache: boolean,
  ): EnvironmentScanDto {
    return {
      ...scan,
      cached: fromCache,
      fetchedAt: cached.fetchedAt.toISOString(),
      expiresAt: cached.expiresAt.toISOString(),
    };
  }

  async fetchStaticMapBuffer(input: {
    latitude: number;
    longitude: number;
    width?: number;
    height?: number;
  }): Promise<Buffer> {
    this.assertConfigured();

    const width = input.width ?? 640;
    const height = input.height ?? 360;
    const lat = input.latitude;
    const lng = input.longitude;
    const cacheKey = this.staticMapCacheKey(lat, lng, width, height);
    const cached = this.staticMapCache.get(cacheKey);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      return cached.buffer;
    }

    if (cached) {
      this.staticMapCache.delete(cacheKey);
    }

    const params = new URLSearchParams({
      center: `${lat},${lng}`,
      zoom: '15',
      size: `${width}x${height}`,
      scale: '2',
      maptype: 'roadmap',
      markers: `color:red|${lat},${lng}`,
      key: this.apiKey,
    });

    const res = await fetch(
      `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`,
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new BadGatewayException(
        `Google Static Maps gagal (${res.status})${errText ? `: ${errText.slice(0, 200)}` : ''}`,
      );
    }

    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    this.staticMapCache.set(cacheKey, {
      buffer,
      expiresAt: now + this.staticMapCacheTtlMs,
    });

    return buffer;
  }

  private staticMapCacheKey(
    latitude: number,
    longitude: number,
    width: number,
    height: number,
  ): string {
    return [
      latitude.toFixed(6),
      longitude.toFixed(6),
      width,
      height,
    ].join(':');
  }

  private async fetchNearbyFromGoogle(
    latitude: number,
    longitude: number,
    radiusMeters: number,
  ): Promise<RawNearbyPlace[]> {
    const res = await fetch(
      'https://places.googleapis.com/v1/places:searchNearby',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey,
          'X-Goog-FieldMask':
            'places.id,places.displayName,places.location,places.types,places.primaryType',
        },
        body: JSON.stringify({
          maxResultCount: 20,
          languageCode: 'id',
          rankPreference: 'DISTANCE',
          locationRestriction: {
            circle: {
              center: { latitude, longitude },
              radius: radiusMeters,
            },
          },
        }),
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new BadGatewayException(
        `Google Places nearby gagal (${res.status})${errText ? `: ${errText.slice(0, 200)}` : ''}`,
      );
    }

    const data = (await res.json()) as GoogleNearbySearchResponse;

    const items: RawNearbyPlace[] = [];

    for (const place of data.places ?? []) {
      const name = place.displayName?.text?.trim();
      const lat = place.location?.latitude;
      const lng = place.location?.longitude;
      if (!place.id || !name || lat === undefined || lng === undefined) {
        continue;
      }

      items.push({
        id: place.id,
        name,
        latitude: lat,
        longitude: lng,
        primaryType: place.primaryType,
        types: place.types ?? [],
      });
    }

    return items;
  }
}
