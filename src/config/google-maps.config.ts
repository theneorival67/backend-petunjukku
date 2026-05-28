import { registerAs } from '@nestjs/config';

export const googleMapsConfig = registerAs('googleMaps', () => ({
  apiKey: process.env.GOOGLE_MAPS_API_KEY?.trim() ?? '',
}));
