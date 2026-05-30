/**
 * Skema contentJson untuk RPP intrakurikuler (CRUD).
 * Acuan: diskusiintra.md — tanpa RAG (cpSource: manual | database untuk tim RAG).
 */

export const INTRAKURIKULER_STAGE_META = [
  {
    stageNumber: 1,
    stageName: 'Identitas dan Konteks Pembelajaran',
  },
  {
    stageNumber: 2,
    stageName: 'Arah Pembelajaran',
  },
  {
    stageNumber: 3,
    stageName: 'Desain Pembelajaran',
  },
  {
    stageNumber: 4,
    stageName: 'Rangkaian Kegiatan per Pertemuan',
  },
  {
    stageNumber: 5,
    stageName: 'Asesmen dan Finalisasi',
  },
] as const;

export type IntrakurikulerJenjang =
  | 'sd'
  | 'smp'
  | 'sma'
  | 'smk'
  | 'kesetaraan'
  | 'pendidikan_khusus';

export type CpSource = 'manual' | 'database';

export type FokusDitentukanOleh = 'guru' | 'ai';

/** Blok umum: input guru + hasil generate/edit (CRUD boleh isi keduanya). */
export type StageContentBase = {
  version: 1;
  inputs: Record<string, unknown>;
  generated?: Record<string, unknown>;
  meta?: Record<string, unknown>;
};

// —— Stage 1 ——
export type Stage1Inputs = {
  jenjang: IntrakurikulerJenjang;
  fase: string;
  kelasSemester: string;
  mataPelajaran: string;
  materiPokokBahasan: string;
  alokasiJpTotal: number;
  jumlahPertemuan: number;
  kondisiKelas?: string;
};

export type Stage1Generated = {
  pembagianJpPerPertemuan?: number[];
  catatanKonteksKelas?: string;
  strukturRppMultiPertemuan?: string;
};

export type Stage1ContentJson = StageContentBase & {
  inputs: Stage1Inputs;
  generated?: Stage1Generated;
  meta?: {
    schoolFromProfile?: boolean;
    teacherFromProfile?: boolean;
  };
};

// —— Stage 2 (CRUD: cp manual; cpExternalIds untuk RAG nanti) ——
export type Stage2LintasDisiplin = {
  inginDikaitkan?: boolean;
  pilihanGuru?: string;
  catatan?: string;
};

export type Stage2Inputs = {
  cpSource: CpSource;
  cpText?: string;
  cpExternalIds?: string[];
  profilLulusan: string[];
  lintasDisiplin?: Stage2LintasDisiplin;
  konteksLokal?: string;
  targetHasilMurid: string;
};

export type Stage2Generated = {
  tujuanPembelajaranUtama?: string[];
  tujuanPembelajaranTurunan?: string[];
  kriteriaKetercapaian?: string[];
  saranLintasDisiplin?: string[];
  ringkasanLintasDisiplin?: string;
};

export type Stage2ContentJson = StageContentBase & {
  inputs: Stage2Inputs;
  generated?: Stage2Generated;
};

// —— Stage 3 ——
export type Stage3Kemitraan = {
  digunakan?: boolean;
  jenis?: string[];
};

export type Stage3Inputs = {
  gayaPembelajaran: string[];
  preferensiPedagogis?: string;
  fasilitasKelas: string[];
  ketersediaanTeknologi: string;
  platformDigital?: string[];
  kemitraan?: Stage3Kemitraan;
  produkKinerjaAkhir: string[];
};

export type Stage3Generated = {
  praktikPedagogis?: string;
  alasanPraktikPedagogis?: string;
  kemitraanDetail?: string;
  pemanfaatanDigital?: string;
  fungsiTeknologiDigital?: string;
  produkKinerjaAkhirNarasi?: string;
};

export type Stage3ContentJson = StageContentBase & {
  inputs: Stage3Inputs;
  generated?: Stage3Generated;
};

// —— Stage 4 ——
export type PertemuanInputs = {
  nomor: number;
  fokusPertemuan?: string;
  targetPertemuan?: string;
  asesmenDiagnostik: string;
  instrumenDiagnostik?: string;
  diferensiasi?: string;
  aktivitasMemahami: string;
  konteksMiniPjbl: string;
  produkSementara: string;
  bentukKerja: string;
  metodeRefleksi: string;
  asesmenFormatif: string;
  umpanBalik?: string;
};

export type PertemuanGenerated = {
  nomor: number;
  aktivitasGuru?: string;
  aktivitasMurid?: string;
  pertanyaanPemantik?: string[];
  masalahKonteksNyata?: string;
  langkahMiniPjbl?: string[];
  pertanyaanRefleksi?: string[];
  instrumenFormatif?: string;
  rubrikObservasi?: string;
};

export type Stage4Inputs = {
  fokusDitentukanOleh: FokusDitentukanOleh;
  pertemuan: PertemuanInputs[];
};

export type Stage4Generated = {
  pertemuan?: PertemuanGenerated[];
  ringkasanPembagian?: string;
};

export type Stage4ContentJson = StageContentBase & {
  inputs: Stage4Inputs;
  generated?: Stage4Generated;
};

// —— Stage 5 ——
export type Stage5Inputs = {
  tpSelesai: boolean;
  jenisSumatif?: string;
  produkDinilai?: string;
  instrumenSumatif?: string;
  kriteriaKetercapaian?: string;
  jumlahSoal?: number | null;
  bentukSoal?: string | null;
  remedial?: string;
  penguatan?: string;
  pengayaan?: string;
  refleksiGuruOtomatis?: boolean;
};

export type DokumenFinalMeta = {
  status: 'draft' | 'ready' | 'exported';
  exportedAt?: string | null;
  fileUrl?: string | null;
};

export type Stage5Generated = {
  asesmenSumatif?: string;
  rubrikSumatif?: Record<string, unknown>;
  kategoriKetercapaian?: string;
  tindakLanjutRemedial?: string;
  tindakLanjutPenguatan?: string;
  tindakLanjutPengayaan?: string;
  refleksiGuru?: string[];
  checklistKelengkapan?: { item: string; done: boolean }[];
  dokumenFinal?: DokumenFinalMeta;
};

export type Stage5ContentJson = StageContentBase & {
  inputs: Stage5Inputs;
  generated?: Stage5Generated;
};

export type IntrakurikulerStageContentByNumber = {
  1: Stage1ContentJson;
  2: Stage2ContentJson;
  3: Stage3ContentJson;
  4: Stage4ContentJson;
  5: Stage5ContentJson;
};

/** Template kosong untuk seed saat create project. */
export function emptyIntrakurikulerStageContent(
  stageNumber: 1 | 2 | 3 | 4 | 5,
): IntrakurikulerStageContentByNumber[typeof stageNumber] {
  const base = { version: 1 as const, inputs: {}, generated: {} };
  switch (stageNumber) {
    case 1:
      return {
        ...base,
        inputs: {
          jenjang: 'smp',
          fase: '',
          kelasSemester: '',
          mataPelajaran: '',
          materiPokokBahasan: '',
          alokasiJpTotal: 0,
          jumlahPertemuan: 1,
        },
      };
    case 2:
      return {
        ...base,
        inputs: {
          cpSource: 'manual',
          cpText: '',
          cpExternalIds: [],
          profilLulusan: [],
          targetHasilMurid: '',
        },
      };
    case 3:
      return {
        ...base,
        inputs: {
          gayaPembelajaran: [],
          fasilitasKelas: [],
          ketersediaanTeknologi: '',
          produkKinerjaAkhir: [],
        },
      };
    case 4:
      return {
        ...base,
        inputs: { fokusDitentukanOleh: 'ai', pertemuan: [] },
      };
    case 5:
      return {
        ...base,
        inputs: { tpSelesai: false },
        generated: {
          dokumenFinal: { status: 'draft', exportedAt: null, fileUrl: null },
        },
      };
    default:
      return base as never;
  }
}
