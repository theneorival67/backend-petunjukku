# Petunjukku NestJS Postman

File yang diimport:

- `petunjukku-nestjs-local.postman_environment.json`
- `petunjukku-nestjs-intrakurikuler.postman_collection.json`

## Cara Pakai Full Flow

1. Pastikan FastAPI AI Service hidup di `http://127.0.0.1:8002`.
2. Pastikan NestJS hidup di `http://localhost:3001`.
3. Import environment dan collection ke Postman.
4. Pilih environment `Petunjukku NestJS Local`.
5. Isi variable environment:
   - `supabaseUrl`
   - `supabaseAnonKey`
   - `supabaseEmail`
   - `supabasePassword`
   - `schoolSearchInput`
6. Jalankan request berurutan dari `00 Supabase Login` sampai `23 Workspace Documents`.

## Urutan Flow

1. Login Supabase untuk menyimpan `accessToken`.
2. Cek health dan sync user dengan `/auth/me`.
3. Cari sekolah lewat Places autocomplete.
4. Ambil detail sekolah dari Places.
5. Scan lingkungan sekitar sekolah.
6. Upsert teacher profile memakai data Places.
7. Buat subject dan class.
8. Buat project intrakurikuler.
9. Simpan Stage 1.
10. Minta rekomendasi Stage 2.
11. Simpan Stage 2 dari CP dan TP hasil rekomendasi.
12. Jalankan KINA Stage 3.
13. Simpan Stage 3 dan Stage 4.
14. Generate RPP final.
15. Ambil generated RPP dan export PDF/DOCX.

## Catatan

- `11 Recommend Stage 2` tidak menyimpan stage otomatis.
- Test script request 11 menyimpan `stage2Cp` dan `stage2TpJson`.
- `12 Save Stage 2 Approved` otomatis membangun body dari `stage2Cp` dan `stage2TpJson`.
- `13 KINA Stage 3 Opening` mengirim `message` kosong agar KINA memulai chat.
- Request chat berikutnya cukup kirim `projectId` dan `message`; history dibaca backend dari tabel `kina_chats`.
- Places dipakai sebelum teacher profile supaya `schoolPlaceId`, koordinat, alamat, dan konteks lingkungan ikut masuk onboarding.
