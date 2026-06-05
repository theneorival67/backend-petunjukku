# Petunjukku NestJS Postman

File yang diimport:

- `petunjukku-nestjs-local.postman_environment.json`
- `petunjukku-nestjs-intrakurikuler.postman_collection.json`

## Cara Pakai

1. Pastikan FastAPI AI Service hidup di `http://127.0.0.1:8002`.
2. Pastikan NestJS hidup di `http://localhost:3001`.
3. Import environment dan collection ke Postman.
4. Pilih environment `Petunjukku NestJS Local`.
5. Isi variable `accessToken` dengan Supabase access token user login.
6. Jalankan request berurutan dari `00 Health` sampai `14 Get Generated RPP`.

## Catatan Intrakurikuler

- `07 Recommend Stage 2` tidak menyimpan stage otomatis.
- Response Stage 2 intrakurikuler berisi `recommendations.capaianPembelajaran`
  dan `recommendations.tujuanPembelajaran`.
- Setelah review, salin CP dan TP tersebut ke `08 Save Stage 2 Approved`.
- `09 KINA Stage 3 Opening` mengirim `message` kosong agar KINA memulai chat.
- Request chat berikutnya cukup kirim `projectId` dan `message`; history dibaca
  backend dari tabel `kina_chats`.
