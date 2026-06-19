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
  category: string;
  colorKey: string;
  relevanceNote: string;
  relevanceScore: number;
};

const EXCLUDED_TYPES = new Set([
  'parking',
  'parking_lot',
  'gas_station',
  'car_wash',
  'atm',
  'bus_stop',
]);

type TypeRule = {
  test: (types: string[], primary?: string) => boolean;
  category: string;
  colorKey: string;
  score: number;
  note: string;
};

const TYPE_RULES: TypeRule[] = [
  {
    test: (t) => t.some((x) => x.includes('park') || x === 'playground'),
    category: 'Ruang terbuka hijau',
    colorKey: 'emerald',
    score: 92,
    note: 'Cocok untuk observasi lingkungan dan proyek lapangan.',
  },
  {
    test: (t) =>
      t.some((x) => ['school', 'library', 'university', 'museum'].includes(x)),
    category: 'Pendidikan & budaya',
    colorKey: 'blue',
    score: 88,
    note: 'Mendukung kolaborasi atau kunjungan belajar.',
  },
  {
    test: (t) =>
      t.some((x) =>
        ['market', 'shopping_mall', 'store', 'supermarket'].includes(x),
      ),
    category: 'Ekonomi & UMKM',
    colorKey: 'amber',
    score: 86,
    note: 'Relevan untuk studi UMKM, matematika, atau IPS lokal.',
  },
  {
    test: (t) => t.some((x) => x.includes('restaurant') || x.includes('cafe')),
    category: 'Pusat makan & komunitas',
    colorKey: 'violet',
    score: 78,
    note: 'Bisa dipakai untuk survei layanan atau budaya lokal.',
  },
  {
    test: (t) =>
      t.some((x) =>
        ['hospital', 'health', 'pharmacy', 'doctor'].some((k) => x.includes(k)),
      ),
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
    category: 'Keagamaan & sosial',
    colorKey: 'slate',
    score: 72,
    note: 'Memperkaya konteks nilai dan kebinekaan.',
  },
  {
    test: (t) =>
      t.some((x) => x.includes('tourist') || x.includes('amusement')),
    category: 'Rekreasi & wisata',
    colorKey: 'cyan',
    score: 70,
    note: 'Potensial untuk eksplorasi geografi atau ekonomi kreatif.',
  },
];

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
        category: rule.category,
        colorKey: rule.colorKey,
        relevanceScore: rule.score,
        relevanceNote: rule.note,
      };
    }
  }

  return {
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
      if (types.some((t) => EXCLUDED_TYPES.has(t))) {
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

  const picked: CuratedNearbyPlace[] = [];
  const usedCategories = new Set<string>();

  for (const item of scored) {
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
    for (const item of scored) {
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
