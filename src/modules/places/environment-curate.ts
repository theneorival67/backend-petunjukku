export type RawNearbyPlace = {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  primaryType?: string;
  types: string[];
};

export type CuratedNearbyPlace = {
  id: string;
  name: string;
  distanceMeters: number;
  distanceLabel: string;
  categoryId: string;
  category: string;
  colorKey: string;
  relevanceNote: string;
  relevanceScore: number;
};

export type NearbyPlaceCandidate = RawNearbyPlace & {
  distanceMeters: number;
  distanceLabel: string;
};

export type EnvironmentCategoryGroup = {
  id: string;
  label: string;
  description: string;
  colorKey: string;
  placeCount: number;
  learningUses: string[];
  places: CuratedNearbyPlace[];
};

export const ENVIRONMENT_CANDIDATE_LIMIT = 500;

const EXCLUDED_TYPES = new Set([
  'parking',
  'parking_lot',
  'gas_station',
  'car_wash',
  'atm',
  'bus_stop',
  'lodging',
  'hotel',
  'motel',
  'night_club',
  'bar',
  'car_repair',
  'car_dealer',
  'route',
  'street_address',
  'intersection',
  'neighborhood',
  'sublocality',
  'political',
]);

const ROUTE_NAME_PATTERN =
  /^(gg\.?|gang|jl\.?|jalan|jln\.?|lorong|kp\.?|kampung|blok)\b/i;
const PRIVATE_OR_NOISY_NAME_PATTERN =
  /\b(rumah|kontrakan|kost|kos|basecamp|secretariat|sekretariat|mberr|test|dummy|mansion|residence|residences|apartment|apartemen|tower|cluster|villa)\b/i;
const TRUSTED_PLACE_TYPES = new Set([
  'restaurant',
  'cafe',
  'bakery',
  'meal_takeaway',
  'supermarket',
  'grocery_store',
  'convenience_store',
  'store',
  'shopping_mall',
  'market',
  'park',
  'playground',
  'garden',
  'museum',
  'library',
  'tourist_attraction',
  'historical_landmark',
  'cultural_landmark',
  'school',
  'primary_school',
  'secondary_school',
  'university',
  'hospital',
  'pharmacy',
  'doctor',
  'dentist',
  'clinic',
  'mosque',
  'church',
  'hindu_temple',
  'place_of_worship',
  'local_government_office',
  'post_office',
  'police',
  'bank',
  'gym',
  'sports_complex',
  'stadium',
]);

type TypeRule = {
  test: (types: string[], primary?: string) => boolean;
  categoryId: string;
  category: string;
  colorKey: string;
  score: number;
  note: string;
};

const TYPE_RULES: TypeRule[] = [
  {
    test: (t) => t.some((x) => x.includes('park') || x === 'playground'),
    categoryId: 'ruang-terbuka',
    category: 'Ruang terbuka & lingkungan',
    colorKey: 'emerald',
    score: 92,
    note: 'Cocok untuk observasi lingkungan, kebersihan, dan aktivitas lapangan.',
  },
  {
    test: (t) =>
      t.some((x) =>
        [
          'museum',
          'tourist_attraction',
          'historical_landmark',
          'cultural_landmark',
        ].includes(x),
      ),
    categoryId: 'budaya-sejarah',
    category: 'Budaya & sejarah',
    colorKey: 'blue',
    score: 91,
    note: 'Relevan untuk cerita lokal, sejarah, budaya, dan identitas tempat.',
  },
  {
    test: (t) => t.some((x) => ['school', 'library', 'university'].includes(x)),
    categoryId: 'pendidikan-literasi',
    category: 'Pendidikan & literasi',
    colorKey: 'blue',
    score: 84,
    note: 'Mendukung kolaborasi, literasi, dan sumber belajar sekitar sekolah.',
  },
  {
    test: (t) =>
      t.some((x) =>
        [
          'market',
          'shopping_mall',
          'store',
          'supermarket',
          'convenience_store',
          'restaurant',
          'cafe',
          'meal_takeaway',
          'bakery',
        ].includes(x),
      ),
    categoryId: 'umkm-ekonomi',
    category: 'UMKM & ekonomi lokal',
    colorKey: 'amber',
    score: 86,
    note: 'Relevan untuk studi jual beli, layanan, kebutuhan warga, dan ekonomi lokal.',
  },
  {
    test: (t) =>
      t.some((x) =>
        ['hospital', 'health', 'pharmacy', 'doctor'].some((k) => x.includes(k)),
      ),
    categoryId: 'kesehatan',
    category: 'Kesehatan',
    colorKey: 'rose',
    score: 75,
    note: 'Mendukung konteks IPA atau PPKn tentang kesehatan.',
  },
  {
    test: (t) =>
      t.some(
        (x) =>
          x.includes('church') ||
          x.includes('mosque') ||
          x.includes('place_of_worship'),
      ),
    categoryId: 'sosial-keagamaan',
    category: 'Sosial & keagamaan',
    colorKey: 'slate',
    score: 72,
    note: 'Memperkaya konteks nilai dan kebinekaan.',
  },
  {
    test: (t) =>
      t.some((x) =>
        [
          'local_government_office',
          'police',
          'post_office',
          'bank',
          'transit_station',
          'train_station',
        ].includes(x),
      ),
    categoryId: 'layanan-publik',
    category: 'Layanan publik & akses',
    colorKey: 'cyan',
    score: 68,
    note: 'Bisa dipakai untuk membahas layanan warga, akses, dan keselamatan.',
  },
];

const CATEGORY_DESCRIPTIONS: Record<string, string> = {
  'ekonomi-lokal':
    'Tempat jual beli, layanan, dan aktivitas ekonomi lokal di sekitar sekolah.',
  'umkm-ekonomi':
    'Tempat jual beli, layanan, dan aktivitas ekonomi lokal di sekitar sekolah.',
  'budaya-sejarah':
    'Tempat atau praktik yang bisa memantik cerita budaya, sejarah, dan identitas lokal.',
  'ruang-terbuka':
    'Area terbuka untuk observasi lingkungan, kebersihan, dan aktivitas lapangan aman.',
  'pendidikan-literasi':
    'Sumber belajar, literasi, dan kolaborasi pendidikan di sekitar sekolah.',
  kesehatan: 'Fasilitas atau konteks yang berkaitan dengan kesehatan warga.',
  'sosial-keagamaan':
    'Ruang sosial, nilai, kebinekaan, dan kehidupan warga sekitar sekolah.',
  'tempat-ibadah':
    'Ruang ibadah dan nilai sosial yang dapat diamati dengan etika dan izin yang tepat.',
  'layanan-publik':
    'Layanan warga, akses, dan titik yang perlu dipertimbangkan untuk keamanan.',
  umum: 'Konteks sekitar sekolah yang masih bisa dipakai untuk observasi umum.',
};

const CATEGORY_LEARNING_USES: Record<string, string[]> = {
  'ekonomi-lokal': [
    'Survei kebutuhan',
    'Data harga/jual beli',
    'Cerita usaha lokal',
  ],
  'umkm-ekonomi': [
    'Survei kebutuhan',
    'Data harga/jual beli',
    'Cerita usaha lokal',
  ],
  'budaya-sejarah': ['Cerita lokal', 'Linimasa perubahan', 'Karya budaya'],
  'ruang-terbuka': ['Observasi lingkungan', 'Kebersihan', 'Sketsa lokasi'],
  'pendidikan-literasi': ['Literasi sumber', 'Kolaborasi belajar', 'Wawancara'],
  kesehatan: ['Kebiasaan sehat', 'Akses layanan', 'Kampanye kesehatan'],
  'sosial-keagamaan': ['Nilai kebinekaan', 'Etika sosial', 'Cerita komunitas'],
  'tempat-ibadah': ['Etika observasi', 'Nilai sosial', 'Cerita komunitas'],
  'layanan-publik': ['Akses aman', 'Layanan warga', 'Pemetaan rute'],
  umum: ['Observasi umum', 'Catatan lapangan', 'Diskusi konteks'],
};

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

export function formatDistanceLabel(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

export function buildNearbyPlaceCandidates(
  centerLat: number,
  centerLng: number,
  raw: RawNearbyPlace[],
  limit = ENVIRONMENT_CANDIDATE_LIMIT,
): NearbyPlaceCandidate[] {
  return raw
    .map((place) => {
      const distanceMeters = haversineMeters(
        centerLat,
        centerLng,
        place.latitude,
        place.longitude,
      );

      return {
        ...place,
        distanceMeters,
        distanceLabel: formatDistanceLabel(distanceMeters),
      };
    })
    .filter(
      (place) =>
        place.distanceMeters >= 30 && isSensibleNearbyPlaceCandidate(place),
    )
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}

export function isSensibleNearbyPlaceCandidate(place: RawNearbyPlace): boolean {
  const name = place.name.replace(/\s+/g, ' ').trim();
  const types = [place.primaryType ?? '', ...(place.types ?? [])]
    .map((type) => type.trim().toLowerCase())
    .filter(Boolean);
  const hasTrustedType = types.some((type) => TRUSTED_PLACE_TYPES.has(type));

  if (name.length < 3 || name.length > 90 || !/[a-zA-ZÀ-ÿ]/.test(name)) {
    return false;
  }

  if (types.some((type) => EXCLUDED_TYPES.has(type))) {
    return false;
  }

  if (PRIVATE_OR_NOISY_NAME_PATTERN.test(name)) {
    return false;
  }

  if (ROUTE_NAME_PATTERN.test(name) && !hasTrustedType) {
    return false;
  }

  if (!hasTrustedType && /^[\w\s.'-]+$/i.test(name) && name.split(/\s+/).length > 5) {
    return false;
  }

  return true;
}

function classifyPlace(
  types: string[],
  primaryType?: string,
): Omit<
  CuratedNearbyPlace,
  'id' | 'name' | 'distanceMeters' | 'distanceLabel'
> {
  const merged = [primaryType?.trim() ?? '', ...types].filter(Boolean);

  for (const rule of TYPE_RULES) {
    if (rule.test(merged, primaryType)) {
      return {
        categoryId: rule.categoryId,
        category: rule.category,
        colorKey: rule.colorKey,
        relevanceScore: rule.score,
        relevanceNote: rule.note,
      };
    }
  }

  return {
    categoryId: 'umum',
    category: 'Lingkungan sekitar',
    colorKey: 'gray',
    relevanceScore: 55,
    relevanceNote: 'Dapat dijadikan konteks observasi umum di sekitar sekolah.',
  };
}

export function curateNearbyPlaces(
  centerLat: number,
  centerLng: number,
  raw: RawNearbyPlace[],
  limit = 6,
): CuratedNearbyPlace[] {
  const scored = raw
    .map((place) => {
      const types = place.types ?? [];
      if (!isSensibleNearbyPlaceCandidate(place)) {
        return null;
      }

      const distanceMeters = haversineMeters(
        centerLat,
        centerLng,
        place.latitude,
        place.longitude,
      );

      if (distanceMeters < 30) {
        return null;
      }

      const meta = classifyPlace(types, place.primaryType);

      return {
        id: place.id,
        name: place.name,
        distanceMeters,
        distanceLabel: formatDistanceLabel(distanceMeters),
        ...meta,
      };
    })
    .filter((item): item is CuratedNearbyPlace => item !== null)
    .sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) {
        return b.relevanceScore - a.relevanceScore;
      }
      return a.distanceMeters - b.distanceMeters;
    });

  const actionable = scored.filter((item) => item.categoryId !== 'umum');
  const candidatePool = actionable.length > 0 ? actionable : scored;
  const picked: CuratedNearbyPlace[] = [];
  const usedCategories = new Set<string>();

  for (const item of candidatePool) {
    if (picked.length >= limit) {
      break;
    }
    if (usedCategories.has(item.category) && picked.length >= 3) {
      continue;
    }
    usedCategories.add(item.category);
    picked.push(item);
  }

  if (picked.length < limit) {
    for (const item of candidatePool) {
      if (picked.length >= limit) {
        break;
      }
      if (!picked.some((p) => p.id === item.id)) {
        picked.push(item);
      }
    }
  }

  return picked.sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export function buildEnvironmentCategoryGroups(
  places: CuratedNearbyPlace[],
): EnvironmentCategoryGroup[] {
  const grouped = new Map<string, CuratedNearbyPlace[]>();

  for (const place of places) {
    const key = place.categoryId || 'umum';
    grouped.set(key, [...(grouped.get(key) ?? []), place]);
  }

  return [...grouped.entries()]
    .map(([id, groupPlaces]) => {
      const sortedPlaces = [...groupPlaces].sort((a, b) => {
        if (b.relevanceScore !== a.relevanceScore) {
          return b.relevanceScore - a.relevanceScore;
        }
        return a.distanceMeters - b.distanceMeters;
      });
      const topPlace = sortedPlaces[0];
      return {
        id,
        label: topPlace.category,
        description:
          CATEGORY_DESCRIPTIONS[id] ??
          'Konteks sekitar sekolah yang dapat dipakai untuk proyek berbasis observasi.',
        colorKey: topPlace.colorKey,
        placeCount: sortedPlaces.length,
        learningUses: CATEGORY_LEARNING_USES[id] ?? CATEGORY_LEARNING_USES.umum,
        places: sortedPlaces.slice(0, 3),
      };
    })
    .filter((group) => group.placeCount >= 2)
    .sort((a, b) => {
      const topA = a.places[0]?.relevanceScore ?? 0;
      const topB = b.places[0]?.relevanceScore ?? 0;
      if (topB !== topA) {
        return topB - topA;
      }
      return b.placeCount - a.placeCount;
    });
}

export function buildEnvironmentSummary(
  places: CuratedNearbyPlace[],
  schoolName?: string,
): string {
  if (places.length === 0) {
    return schoolName
      ? `Belum ditemukan titik lingkungan signifikan dalam radius pencarian dari ${schoolName}. Anda bisa melengkapi konteks lokal secara manual di langkah berikutnya.`
      : 'Belum ditemukan titik lingkungan signifikan dalam radius pencarian.';
  }

  const categories = [...new Set(places.map((p) => p.category.toLowerCase()))];
  const label = schoolName ? `sekitar ${schoolName}` : 'sekitar lokasi sekolah';

  return `Ditemukan ${places.length} titik ${label} yang relevan untuk pembelajaran berbasis konteks (${categories.slice(0, 3).join(', ')}). Data ini dapat dipakai AI untuk menyusun RPM yang terhubung dengan lingkungan nyata murid.`;
}
