# Deprecated: bukan acuan stage v5

Dokumen ini sebelumnya berisi rancangan lama 5 stage intrakurikuler seperti
`Identitas dan Konteks Pembelajaran`, `Arah Pembelajaran`, dan seterusnya.
Rancangan itu **bukan acuan API Documentation Petunjukku v5**.

Acuan aktif sekarang:

- [API Documentation Petunjukku v5](./api-documentation-petunjukku-v5.md)
- file Word asli: `API_Documentation_Petunjukku_v5.docx`

Menurut API Documentation v5:

- `rpp_stages.content_json` adalah JSON fleksibel yang disimpan dari frontend.
- Backend tidak melakukan seed nama stage bawaan saat `POST /rpp/projects`.
- Stage dibuat/disimpan lewat `POST /rpp/projects/:projectId/stages`.
- AI recommendation hanya berlaku untuk `stageNumber = 2`.
- Stage 2 Intrakurikuler menghasilkan `Alur Tujuan Pembelajaran`.
- Stage 2 PjBL Kokurikuler menghasilkan rekomendasi proyek berdasarkan konteks Stage 1.

Jika struktur/nama stage final berubah di frontend, backend cukup menerima
`stageNumber`, `stageName`, `contentJson`, dan `isCompleted` lewat Stage API.
