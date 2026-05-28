# Skema CRUD RPP Intrakurikuler

Acuan: `diskusiintra.md` (tanpa RAG — CP ditulis manual / placeholder ID untuk tim RAG nanti).

## Model data

```
RppProject          → metadata proyek + field Stage 1 yang sering difilter
RppStage            → stageNumber 1–5, stageName, contentJson (skema per stage)
```

Tim RAG nanti bisa menambah endpoint terpisah; Stage 2 cukup simpan `cpText` atau `cpExternalIds[]` tanpa validasi ke database pemerintah.

---

## Kolom `rpp_projects` (disarankan ditambah)

Field ini memudahkan list/filter tanpa membuka JSON stage 1.

| Kolom | Tipe | Wajib | Keterangan |
|-------|------|-------|------------|
| `topic` | string | ya | Materi / pokok bahasan |
| `totalJp` | int | ya | Total alokasi JP |
| `meetingCount` | int | ya | Jumlah pertemuan |
| `semester` | string? | ops | Semester (mis. "Ganjil 2025") |
| `classConditions` | text? | ops | Kondisi khusus kelas |

Field yang **sudah ada**: `subject`, `phase`, `gradeLevel`, `title`, `schoolId`, `teacherSubjectId`, `teacherClassId`.

Identitas dari profil (tidak duplikasi wajib di stage): `fullName` guru, nama sekolah → dari relasi profil/sekolah.

---

## Stage 1 — Identitas dan Konteks Pembelajaran

`stageNumber`: **1**  
`stageName`: `"Identitas dan Konteks Pembelajaran"`

Bagian RPP: **A. Identitas Pembelajaran**

### `contentJson`

```json
{
  "version": 1,
  "inputs": {
    "jenjang": "smp",
    "fase": "D",
    "kelasSemester": "Kelas 7 / Semester Ganjil",
    "mataPelajaran": "IPA",
    "materiPokokBahasan": "Sistem pencernaan manusia",
    "alokasiJpTotal": 6,
    "jumlahPertemuan": 3,
    "kondisiKelas": "Murid beragam kemampuan, proyektor tersedia"
  },
  "generated": {
    "pembagianJpPerPertemuan": [2, 2, 2],
    "catatanKonteksKelas": "…",
    "strukturRppMultiPertemuan": "…"
  },
  "meta": {
    "schoolFromProfile": true,
    "teacherFromProfile": true
  }
}
```

| Field `inputs` | Wajib | Catatan |
|----------------|-------|---------|
| `jenjang` | ya | `sd` \| `smp` \| `sma` \| `smk` \| `kesetaraan` \| `pendidikan_khusus` |
| `fase` | ya | Pilgan / kode fase kurikulum |
| `kelasSemester` | ya | Teks bebas |
| `mataPelajaran` | ya | Bisa sinkron dari `rpp_projects.subject` |
| `materiPokokBahasan` | ya | Sinkron dari `rpp_projects.topic` |
| `alokasiJpTotal` | ya | Sinkron dari `rpp_projects.totalJp` |
| `jumlahPertemuan` | ya | Sinkron dari `rpp_projects.meetingCount` |
| `kondisiKelas` | ops | Sinkron dari `rpp_projects.classConditions` |

`generated` diisi backend/AI nanti; untuk CRUD boleh kosong atau diedit guru.

---

## Stage 2 — Arah Pembelajaran

`stageNumber`: **2**  
`stageName`: `"Arah Pembelajaran"`

Bagian RPP: **B. Profil dan Arah Pembelajaran**

### `contentJson` (tanpa RAG)

```json
{
  "version": 1,
  "inputs": {
    "cpSource": "manual",
    "cpText": "Murid mampu menjelaskan proses pencernaan…",
    "cpExternalIds": [],
    "profilLulusan": ["penalaran_kritis", "komunikasi"],
    "lintasDisiplin": {
      "inginDikaitkan": true,
      "pilihanGuru": "bahasa_indonesia",
      "catatan": ""
    },
    "konteksLokal": "Lingkungan pasar tradisional dekat sekolah",
    "targetHasilMurid": "Murid dapat membuat infografik alur pencernaan"
  },
  "generated": {
    "tujuanPembelajaranUtama": ["…"],
    "tujuanPembelajaranTurunan": ["…"],
    "kriteriaKetercapaian": ["…"],
    "saranLintasDisiplin": ["…"],
    "ringkasanLintasDisiplin": "…"
  }
}
```

| Field | Wajib | Catatan |
|-------|-------|---------|
| `cpSource` | ya | `manual` (sekarang) \| `database` (tim RAG) |
| `cpText` | ya jika `manual` | Teks CP guru |
| `cpExternalIds` | ops | Reserved untuk RAG |
| `profilLulusan` | ya | 1–3 string |
| `targetHasilMurid` | ya | Teks |
| `lintasDisiplin.inginDikaitkan` | ops | boolean |
| `konteksLokal` | ops | Teks |

---

## Stage 3 — Desain Pembelajaran

`stageNumber`: **3**  
`stageName`: `"Desain Pembelajaran"`

Bagian RPP: **C. Desain Pembelajaran**

### `contentJson`

```json
{
  "version": 1,
  "inputs": {
    "gayaPembelajaran": ["diskusi", "eksperimen"],
    "preferensiPedagogis": "inquiry",
    "fasilitasKelas": ["proyektor", "hp_murid", "internet"],
    "ketersediaanTeknologi": "ya",
    "platformDigital": ["google_form", "canva"],
    "kemitraan": {
      "digunakan": true,
      "jenis": ["guru_mapel_lain", "komunitas"]
    },
    "produkKinerjaAkhir": ["poster", "presentasi"]
  },
  "generated": {
    "praktikPedagogis": "Inquiry + mini-PjBL",
    "alasanPraktikPedagogis": "…",
    "kemitraanDetail": "…",
    "pemanfaatanDigital": "…",
    "fungsiTeknologiDigital": "…",
    "produkKinerjaAkhirNarasi": "…"
  }
}
```

Semua field `inputs` wajib kecuali `platformDigital`, `kemitraan` (opsional di dokumen).

---

## Stage 4 — Rangkaian Pertemuan

`stageNumber`: **4**  
`stageName`: `"Rangkaian Kegiatan per Pertemuan"`

Bagian RPP: **D. Rangkaian Kegiatan Pembelajaran per Pertemuan**

### `contentJson`

```json
{
  "version": 1,
  "inputs": {
    "fokusDitentukanOleh": "ai",
    "pertemuan": [
      {
        "nomor": 1,
        "fokusPertemuan": "Memahami konsep dasar",
        "targetPertemuan": "Murid menjelaskan organ pencernaan",
        "asesmenDiagnostik": "pertanyaan_pemantik",
        "instrumenDiagnostik": "lembar_kerja",
        "diferensiasi": "kelompok_kecil",
        "aktivitasMemahami": "demonstrasi",
        "konteksMiniPjbl": "lingkungan_sekolah",
        "produkSementara": "mind_map",
        "bentukKerja": "kelompok",
        "metodeRefleksi": "diskusi",
        "asesmenFormatif": "exit_ticket",
        "umpanBalik": "lisan"
      }
    ]
  },
  "generated": {
    "pertemuan": [
      {
        "nomor": 1,
        "aktivitasGuru": "…",
        "aktivitasMurid": "…",
        "pertanyaanPemantik": ["…"],
        "masalahKonteksNyata": "…",
        "langkahMiniPjbl": ["…"],
        "pertanyaanRefleksi": ["…"],
        "instrumenFormatif": "…",
        "rubrikObservasi": "…"
      }
    ],
    "ringkasanPembagian": "Pertemuan 1: …, Pertemuan 2: …"
  }
}
```

| Field | Wajib |
|-------|-------|
| `fokusDitentukanOleh` | ya — `guru` \| `ai` |
| `pertemuan[].nomor` | ya — 1..n, n = `meetingCount` |
| Field per pertemuan (diagnostik, memahami, dll.) | ya di `inputs` (guru pilih) |
| Detail aktivitas panjang | `generated` (AI nanti; CRUD bisa edit manual) |

Validasi: `pertemuan.length` harus sama dengan `rpp_projects.meetingCount`.

---

## Stage 5 — Asesmen dan Finalisasi

`stageNumber`: **5**  
`stageName`: `"Asesmen dan Finalisasi"`

Bagian RPP: asesmen sumatif, tindak lanjut, refleksi guru, checklist

### `contentJson`

```json
{
  "version": 1,
  "inputs": {
    "tpSelesai": true,
    "jenisSumatif": "produk",
    "produkDinilai": "Poster dan presentasi kelompok",
    "instrumenSumatif": "rubrik",
    "kriteriaKetercapaian": "skala_huruf",
    "jumlahSoal": null,
    "bentukSoal": null,
    "remedial": "",
    "penguatan": "",
    "pengayaan": "",
    "refleksiGuruOtomatis": true
  },
  "generated": {
    "asesmenSumatif": "…",
    "rubrikSumatif": {},
    "kategoriKetercapaian": "…",
    "tindakLanjutRemedial": "…",
    "tindakLanjutPenguatan": "…",
    "tindakLanjutPengayaan": "…",
    "refleksiGuru": ["…"],
    "checklistKelengkapan": [
      { "item": "Identitas lengkap", "done": true }
    ],
    "dokumenFinal": {
      "status": "draft",
      "exportedAt": null,
      "fileUrl": null
    }
  }
}
```

| Field | Wajib |
|-------|-------|
| `tpSelesai` | ya |
| `jenisSumatif`, `produkDinilai`, `instrumenSumatif`, `kriteriaKetercapaian` | wajib jika `tpSelesai === true` |
| `jumlahSoal`, `bentukSoal` | ops (tes tertulis) |
| `remedial`, `penguatan`, `pengayaan` | bisa kosong; diisi AI/guru |

Export PDF: field `generated.dokumenFinal` — CRUD status saja; generate file tim lain / fase berikutnya.

---

## API CRUD (yang dipakai)

| Aksi | Endpoint |
|------|----------|
| Buat proyek | `POST /rpp/projects` |
| Update proyek | `PATCH /rpp/projects/:id` |
| Simpan stage | `POST /rpp/projects/:projectId/stages` body: `SaveRppStageDto` |
| Update stage | `PATCH /rpp/projects/:projectId/stages/:stageNumber` |
| List stage | `GET /rpp/projects/:projectId/stages` |

### Seed 5 stage (disarankan saat create project intra)

```json
[
  { "stageNumber": 1, "stageName": "Identitas dan Konteks Pembelajaran", "contentJson": { "version": 1, "inputs": {}, "generated": {} } },
  { "stageNumber": 2, "stageName": "Arah Pembelajaran", "contentJson": { "version": 1, "inputs": { "cpSource": "manual" }, "generated": {} } },
  { "stageNumber": 3, "stageName": "Desain Pembelajaran", "contentJson": { "version": 1, "inputs": {}, "generated": {} } },
  { "stageNumber": 4, "stageName": "Rangkaian Kegiatan per Pertemuan", "contentJson": { "version": 1, "inputs": { "pertemuan": [] }, "generated": {} } },
  { "stageNumber": 5, "stageName": "Asesmen dan Finalisasi", "contentJson": { "version": 1, "inputs": { "tpSelesai": false }, "generated": {} } }
]
```

---

## Yang sengaja tidak masuk scope CRUD sekarang

- Pencarian / autocomplete CP dari database pemerintah (tim RAG)
- Generate AI otomatis (bisa tulis manual ke `generated` dulu)
- `POST /studio-sessions` di FE — diganti ke `/rpp/projects` saat integrasi

---

## File tipe TypeScript

Lihat: `be/src/modules/rpp/schemas/intrakurikuler-stage-content.ts`
