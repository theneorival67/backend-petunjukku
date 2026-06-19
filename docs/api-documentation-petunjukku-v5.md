# API Documentation Petunjukku v5

Base URL local: `http://localhost:3001`

Swagger: `GET /docs`

Semua endpoint private memakai:

```http
Authorization: Bearer <supabase_access_token>
```

Endpoint publik:

```http
GET /health
```

## Arsitektur

- Frontend hanya memanggil NestJS.
- Auth memakai Supabase Auth.
- Database utama memakai Supabase PostgreSQL via Prisma.
- FastAPI adalah AI service internal dan tidak dipanggil langsung oleh frontend.
- NestJS memanggil FastAPI melalui `AiGatewayService`.
- FastAPI tidak menulis ke database utama.
- Export PDF/DOCX dilakukan oleh NestJS dan disimpan ke Supabase Storage.

## Environment

```env
APP_PORT=3001
DATABASE_URL=...
DIRECT_URL=...
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_STORAGE_BUCKET_DOCUMENTS=documents
GOOGLE_MAPS_API_KEY=...
AI_ENABLED=true
AI_SERVICE_BASE_URL=http://localhost:8000
INTERNAL_API_KEY=change-this-internal-key
AI_REQUEST_TIMEOUT_MS=60000
```

## Health

```http
GET /health
```

Mengecek status API, Prisma/database, Supabase, env, dan timestamp.

## Auth

```http
GET /auth/me
```

Mengambil user login dari Supabase access token.

## Teacher Profile

```http
GET /teacher-profile/me
POST /teacher-profile
PATCH /teacher-profile/me
GET /teacher-profile/subjects
POST /teacher-profile/subjects
GET /teacher-profile/classes
POST /teacher-profile/classes
```

Profil guru dapat membuat/menghubungkan sekolah otomatis dari input onboarding dan Places.

## Places / Google Maps Context

```http
GET /places/autocomplete?input=<nama_sekolah>
GET /places/details?placeId=<google_place_id>
GET /places/nearby-environment?latitude=<lat>&longitude=<lng>
GET /places/static-map?latitude=<lat>&longitude=<lng>
```

Tujuan:

- autocomplete nama sekolah,
- mengambil detail lokasi sekolah,
- mengambil latitude dan longitude,
- membaca konteks lingkungan sekitar sekolah,
- mengambil static map,
- menyediakan konteks sekolah untuk AI.

API key Google hanya berada di backend sebagai `GOOGLE_MAPS_API_KEY`.

## RPM Projects

```http
POST /rpp/projects
GET /rpp/projects
GET /rpp/projects?archived=true
GET /rpp/projects/:id
PATCH /rpp/projects/:id
POST /rpp/projects/:id/archive
DELETE /rpp/projects/:id
```

Archive memakai soft status `archived`. Delete menghapus permanen.

## RPM Stages

```http
GET /rpp/projects/:projectId/stages
GET /rpp/projects/:projectId/stages/:stageNumber
POST /rpp/projects/:projectId/stages
PATCH /rpp/projects/:projectId/stages/:stageNumber
```

Stage disimpan fleksibel di `rpp_stages.content_json`.

API Documentation v5 tidak menetapkan seed nama stage bawaan di backend.
Frontend mengirim `stageNumber`, `stageName`, `contentJson`, dan `isCompleted`
melalui Stage API. Backend tidak membuat stage otomatis saat `POST /rpp/projects`.

## AI Recommendation Stage 2

```http
POST /rpp/projects/:projectId/ai/stages/:stageNumber/recommend
```

Aturan:

- hanya menerima `stageNumber = 2`,
- validasi project milik user login,
- mengambil context dari database,
- meneruskan payload ke FastAPI:

```http
POST /internal/ai/recommend-stage
```

- tidak menyimpan hasil recommendation ke `rpp_stages`,
- frontend/guru harus review/edit,
- hasil final disimpan lewat endpoint stage.

Output `intrakurikuler` bertipe `learning_objectives_flow`.

Output `pjbl_kokurikuler` bertipe `project_recommendation`.

## RAG

```http
POST /rag/search
```

NestJS meneruskan pencarian CP ke FastAPI/RAG service dan menyimpan log ke `rag_retrieval_logs`.

## KINA Chat

```http
GET /ai/status
POST /ai/kina/chat
POST /ai/kina/session-title
GET /ai/kina/chats/:projectId
```

KINA chat:

- menerima `projectId` dan `message`, atau kompatibel dengan `messages[]`,
- validasi project milik user login,
- mengambil konteks profil, sekolah, kelas, project, dan stages,
- meneruskan payload ke FastAPI:

```http
POST /internal/ai/kina/chat
POST /internal/ai/kina/session-title
```

- menyimpan pesan user dan jawaban assistant ke `kina_chats`.

## Generated RPM

```http
POST /ai/generate-rpp/:projectId
GET /ai/generated-rpp/:projectId
PUT /ai/generated-rpp/:generatedRppId
```

`POST /ai/generate-rpp/:projectId`:

- mengambil project, teacher profile, school, subject, class, stages, chat summary, dan konteks Places,
- meneruskan payload ke FastAPI:

```http
POST /internal/ai/generate-rpp
```

- menyimpan `contentJson`, `contentMarkdown`, `usedReferences`, dan `model` ke `generated_rpps`,
- menyimpan references ke `rag_retrieval_logs` jika tersedia,
- update status project menjadi `generated`.

FastAPI tidak menulis ke database utama.

## Documents

```http
POST /documents/export/pdf/:generatedRppId
POST /documents/export/docx/:generatedRppId
GET /documents/download/:documentId
```

NestJS:

- validasi generated RPM milik user login,
- render PDF/DOCX,
- upload ke Supabase Storage bucket `documents`,
- simpan metadata ke `exported_documents`,
- mengembalikan URL dokumen.

FastAPI tidak membuat PDF/DOCX.

## Workspace

```http
GET /workspace/projects
GET /workspace/documents
```

Workspace tidak memakai tabel khusus.

- `GET /workspace/projects` membaca `rpp_projects`.
- `GET /workspace/documents` membaca `generated_rpps` dan `exported_documents`.

Semua data difilter berdasarkan user login.

## FastAPI Internal Contract

FastAPI internal perlu menyediakan:

```http
POST /internal/ai/recommend-stage
POST /internal/ai/generate-rpp
POST /internal/ai/kina/chat
POST /internal/ai/kina/session-title
POST /internal/ai/curate-school-environment
POST /cp/resolve
```

NestJS mengirim header:

```http
X-Internal-API-Key: <INTERNAL_API_KEY>
```

## Manual Test Order

1. `GET /health`
2. `GET /auth/me`
3. `POST /teacher-profile`
4. `POST /teacher-profile/subjects`
5. `POST /teacher-profile/classes`
6. `GET /places/autocomplete?input=<nama_sekolah>`
7. `GET /places/details?placeId=<google_place_id>`
8. `GET /places/nearby-environment?latitude=<lat>&longitude=<lng>`
9. `POST /rpp/projects`
10. `POST /rpp/projects/:projectId/stages` untuk stage awal sesuai flow frontend
11. `POST /rpp/projects/:projectId/ai/stages/2/recommend`
12. `POST /rpp/projects/:projectId/stages` untuk Stage 2 hasil approve
13. `POST /ai/kina/chat`
14. `GET /ai/kina/chats/:projectId`
15. `POST /ai/generate-rpp/:projectId`
16. `GET /ai/generated-rpp/:projectId`
17. `POST /documents/export/pdf/:generatedRppId`
18. `POST /documents/export/docx/:generatedRppId`
19. `GET /documents/download/:documentId`
20. `GET /workspace/projects`
21. `GET /workspace/documents`
