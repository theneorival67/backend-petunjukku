import type { CuratedNearbyPlace } from '../places/environment-curate';

export type AiEnvironmentCurationResult = {
  summary: string;
  places: CuratedNearbyPlace[];
};

export type AiEnvironmentResponseJson = {
  summary?: string;
  places?: Array<{
    id?: string;
    category?: string;
    colorKey?: string;
    relevanceNote?: string;
    relevanceScore?: number;
  }>;
};
