import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import type { KinaChatMessageDto } from './dto/kina-chat.dto';
import {
  curateNearbyPlaces,
  formatDistanceLabel,
  type CuratedNearbyPlace,
  type RawNearbyPlace,
} from '../places/environment-curate';
import type { AiEnvironmentResponseJson } from './ai-environment.types';
import { OpencodeGoClient } from './opencode-go.client';

const ALLOWED_COLOR_KEYS = new Set([
  'emerald',
  'amber',
  'blue',
  'violet',
  'rose',
  'slate',
  'cyan',
  'gray',
]);

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly opencodeGo: OpencodeGoClient,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  isEnabled(): boolean {
    return this.opencodeGo.isConfigured();
  }

  async suggestSessionTitle(message: string): Promise<{
    title: string;
    source: 'opencode_go' | 'fallback';
  }> {
    const cleaned = message.trim().slice(0, 2000);
    const fallback = this.fallbackSessionTitle(cleaned);

    if (!cleaned) {
      return { title: 'Percakapan baru', source: 'fallback' };
    }

    if (!this.isEnabled()) {
      return { title: fallback, source: 'fallback' };
    }

    const cfg = this.configService.get('ai', { infer: true })!;

    try {
      const parsed = await this.opencodeGo.chatCompletionJson<{
        title?: string;
      }>({
        model: cfg.envModel,
        apiPath: cfg.envApiPath,
        messages: [
          {
            role: 'system',
            content: `Anda membuat judul singkat untuk sesi perencanaan pembelajaran guru Indonesia.
Aturan:
- Maksimal 50 karakter, Bahasa Indonesia natural
- Fokus topik/mata pelajaran/intensi dari pesan guru
- JANGAN gunakan judul generik seperti "RPP Intrakurikuler Baru" atau "RPP Kokurikuler Baru"
- Tanpa tanda kutip, tanpa emoji
- Balas hanya JSON: {"title":"..."}`,
          },
          {
            role: 'user',
            content: `Pesan guru:\n${cleaned}`,
          },
        ],
        maxTokens: 120,
      });

      return {
        title: this.normalizeSessionTitle(parsed.title, fallback),
        source: 'opencode_go',
      };
    } catch (error) {
      this.logger.warn(
        `Judul sesi AI gagal: ${error instanceof Error ? error.message : error}`,
      );
      return { title: fallback, source: 'fallback' };
    }
  }

  private fallbackSessionTitle(message: string): string {
    let t = message.replace(/\s+/g, ' ').trim();
    t = t.replace(
      /^(halo|hai|hei|pagi|siang|sore|malam|selamat\s+\w+|assalamualaikum)[,!\s]+/i,
      '',
    );
    t = t.replace(/^(tolong|bantu|mohon)\s+/i, '');
    t = t.trim();
    if (!t) {
      t = message.replace(/\s+/g, ' ').trim();
    }
    if (t.length > 56) {
      const cut = t.slice(0, 56);
      const lastSpace = cut.lastIndexOf(' ');
      t = lastSpace > 20 ? `${cut.slice(0, lastSpace)}…` : `${cut}…`;
    }
    return t || 'Percakapan baru';
  }

  private normalizeSessionTitle(
    raw: string | undefined,
    fallback: string,
  ): string {
    let t = raw?.trim().replace(/^["']|["']$/g, '') ?? '';
    if (
      !t ||
      t.length < 3 ||
      /rpp\s+(intrakurikuler|kokurikuler)\s+baru/i.test(t)
    ) {
      return fallback;
    }
    if (t.length > 60) {
      const cut = t.slice(0, 57);
      const lastSpace = cut.lastIndexOf(' ');
      t = lastSpace > 20 ? `${cut.slice(0, lastSpace)}…` : `${cut}…`;
    }
    return t;
  }

  async kinaChat(
    user: AuthUser,
    messages: KinaChatMessageDto[],
  ): Promise<{
    reply: string;
    model: string;
    source: 'opencode_go' | 'fallback';
  }> {
    const cfg = this.configService.get('ai', { infer: true })!;
    const trimmed = messages
      .filter((m) => m.content?.trim())
      .slice(-20)
      .map((m) => ({
        role: m.role,
        content: m.content.trim().slice(0, 4000),
      }));

    if (trimmed.length === 0) {
      return {
        reply:
          'Silakan tulis pertanyaan Anda—saya siap membantu merencanakan pembelajaran.',
        model: 'fallback',
        source: 'fallback',
      };
    }

    const profileContext = await this.buildKinaProfileContext(user);
    const systemPrompt = this.buildKinaSystemPrompt(profileContext);

    if (!this.isEnabled()) {
      return {
        reply: this.fallbackKinaReply(
          trimmed[trimmed.length - 1]?.content ?? '',
        ),
        model: 'fallback',
        source: 'fallback',
      };
    }

    try {
      const reply = await this.opencodeGo.chatCompletionText({
        model: cfg.chatModel,
        apiPath: cfg.chatApiPath,
        messages: [
          { role: 'system', content: systemPrompt },
          ...trimmed.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        ],
        maxTokens: cfg.maxTokens,
        temperature: 0.65,
      });

      return {
        reply: reply.trim(),
        model: cfg.chatModel,
        source: 'opencode_go',
      };
    } catch (error) {
      this.logger.warn(
        `KINA chat gagal: ${error instanceof Error ? error.message : error}`,
      );
      return {
        reply: this.fallbackKinaReply(
          trimmed[trimmed.length - 1]?.content ?? '',
        ),
        model: 'fallback',
        source: 'fallback',
      };
    }
  }

  private async buildKinaProfileContext(user: AuthUser): Promise<string> {
    try {
      const profile = await this.prisma.teacherProfile.findUnique({
        where: { userId: user.id },
        include: { school: true },
      });
      if (!profile) {
        return user.name ? `Nama guru: ${user.name}.` : '';
      }
      const parts = [
        `Nama guru: ${profile.fullName}`,
        profile.school?.name ? `Sekolah: ${profile.school.name}` : null,
        profile.school?.city ? `Kota: ${profile.school.city}` : null,
      ].filter(Boolean);
      return parts.join('\n');
    } catch {
      return user.name ? `Nama guru: ${user.name}.` : '';
    }
  }

  private buildKinaSystemPrompt(profileContext: string): string {
    return `Anda adalah KINA, asisten AI Studio Guru di aplikasi petunjukKU untuk guru Indonesia.

Peran Anda:
- Membantu guru merencanakan pembelajaran intrakurikuler dan kokurikuler (RPP).
- Menjawab singkat, jelas, ramah, dalam Bahasa Indonesia.
- Jika guru ingin menyusun RPP lengkap, arahkan ke Studio Guru: pilih kartu Intrakurikuler atau Kokurikuler di layar utama.
- Jangan mengarang kebijakan resmi Kemendikbud; jika ragu, sampaikan bahwa guru perlu verifikasi sumber resmi.
- Jangan meminta data pribadi murid yang sensitif.

${profileContext ? `Konteks guru:\n${profileContext}` : ''}`.trim();
  }

  private fallbackKinaReply(userText: string): string {
    const lower = userText.toLowerCase();
    if (lower.includes('rpp') || lower.includes('rencana')) {
      return 'Untuk menyusun RPP, pilih kartu Pembelajaran Intrakurikuler atau Kokurikuler di atas. KINA akan memandu langkah demi langkah di Studio Guru.';
    }
    if (lower.includes('halo') || lower.includes('hai')) {
      return 'Halo! Saya KINA, asisten Studio Guru PetunjukKU. Ada yang ingin Anda kerjakan hari ini?';
    }
    return 'Terima kasih atas pertanyaannya. Untuk menyusun RPP terstruktur, silakan buka Studio Guru lewat kartu Intrakurikuler atau Kokurikuler. Saya juga bisa menjawab pertanyaan singkat tentang perencanaan pembelajaran—coba tanyakan lagi setelah layanan AI aktif.';
  }

  async curateSchoolEnvironment(input: {
    schoolName?: string;
    schoolAddress?: string;
    latitude: number;
    longitude: number;
    radiusMeters: number;
    rawPlaces: RawNearbyPlace[];
  }): Promise<{
    places: CuratedNearbyPlace[];
    summary: string;
    usedAi: boolean;
  }> {
    const ruleBased = curateNearbyPlaces(
      input.latitude,
      input.longitude,
      input.rawPlaces,
      8,
    );

    if (!this.isEnabled()) {
      return {
        places: ruleBased.slice(0, 6),
        summary: this.fallbackSummary(ruleBased, input.schoolName),
        usedAi: false,
      };
    }

    const candidates =
      ruleBased.length >= 4
        ? ruleBased
        : curateNearbyPlaces(
            input.latitude,
            input.longitude,
            input.rawPlaces,
            12,
          );

    if (candidates.length === 0) {
      return {
        places: [],
        summary: this.fallbackSummary([], input.schoolName),
        usedAi: false,
      };
    }

    const cfg = this.configService.get('ai', { infer: true })!;

    const candidatePayload = candidates.map((p) => ({
      id: p.id,
      name: p.name,
      distanceMeters: p.distanceMeters,
      distanceLabel: p.distanceLabel,
      category: p.category,
      colorKey: p.colorKey,
    }));

    const systemPrompt = `Anda adalah asisten pedagogis untuk guru Indonesia yang menyusun RPP berbasis konteks lokal.
Pilih 4-6 lokasi di sekitar sekolah yang paling relevan untuk pembelajaran (observasi lingkungan, PBL, IPS, IPA, kewirausahaan).
Gunakan HANYA id dari daftar kandidat. Jawab dalam Bahasa Indonesia.
colorKey harus salah satu: emerald, amber, blue, violet, rose, slate, cyan, gray.
relevanceScore 0-100.`;

    const userPrompt = JSON.stringify({
      sekolah: input.schoolName ?? 'Sekolah',
      alamat: input.schoolAddress ?? '',
      radiusMeter: input.radiusMeters,
      kandidat: candidatePayload,
    });

    try {
      const parsed =
        await this.opencodeGo.chatCompletionJson<AiEnvironmentResponseJson>({
          model: cfg.envModel,
          apiPath: cfg.envApiPath,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: `Kurasi lingkungan sekitar sekolah. Balas JSON dengan bentuk:
{"summary":"string","places":[{"id":"string","category":"string","colorKey":"string","relevanceNote":"string","relevanceScore":number}]}
Data:\n${userPrompt}`,
            },
          ],
          maxTokens: Math.min(cfg.maxTokens, 1200),
        });

      const merged = this.mergeAiCuration(candidates, parsed);
      if (merged.places.length === 0) {
        throw new Error('AI tidak memilih lokasi valid');
      }

      return {
        places: merged.places,
        summary:
          merged.summary.trim() ||
          this.fallbackSummary(merged.places, input.schoolName),
        usedAi: true,
      };
    } catch (error) {
      this.logger.warn(
        `Kurasi AI gagal, pakai aturan: ${error instanceof Error ? error.message : error}`,
      );
      return {
        places: ruleBased.slice(0, 6),
        summary: this.fallbackSummary(ruleBased, input.schoolName),
        usedAi: false,
      };
    }
  }

  private mergeAiCuration(
    candidates: CuratedNearbyPlace[],
    ai: AiEnvironmentResponseJson,
  ): { places: CuratedNearbyPlace[]; summary: string } {
    const byId = new Map(candidates.map((p) => [p.id, p]));
    const places: CuratedNearbyPlace[] = [];

    for (const row of ai.places ?? []) {
      const id = row.id?.trim();
      if (!id) {
        continue;
      }
      const base = byId.get(id);
      if (!base) {
        continue;
      }

      const colorKey = ALLOWED_COLOR_KEYS.has(row.colorKey ?? '')
        ? (row.colorKey as string)
        : base.colorKey;

      places.push({
        id: base.id,
        name: base.name,
        distanceMeters: base.distanceMeters,
        distanceLabel: formatDistanceLabel(base.distanceMeters),
        category: row.category?.trim() || base.category,
        colorKey,
        relevanceNote: row.relevanceNote?.trim() || base.relevanceNote,
        relevanceScore:
          typeof row.relevanceScore === 'number'
            ? Math.max(0, Math.min(100, row.relevanceScore))
            : base.relevanceScore,
      });
    }

    return {
      places: places.slice(0, 6),
      summary: ai.summary?.trim() ?? '',
    };
  }

  private fallbackSummary(
    places: CuratedNearbyPlace[],
    schoolName?: string,
  ): string {
    if (places.length === 0) {
      return schoolName
        ? `Belum ditemukan titik lingkungan signifikan dalam radius pencarian dari ${schoolName}.`
        : 'Belum ditemukan titik lingkungan signifikan dalam radius pencarian.';
    }
    const label = schoolName
      ? `sekitar ${schoolName}`
      : 'sekitar lokasi sekolah';
    return `Ditemukan ${places.length} titik ${label} yang dapat dipakai sebagai konteks pembelajaran.`;
  }
}
