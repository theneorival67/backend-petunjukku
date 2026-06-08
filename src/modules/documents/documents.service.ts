import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExportFileType, Prisma } from '@prisma/client';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseService } from '../../supabase/supabase.service';

type DocumentBlock =
  | { type: 'title'; text: string }
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'checklist'; text: string; checked: boolean }
  | { type: 'table'; rows: MetadataRow[] }
  | { type: 'spacer' };

type MetadataRow = { key: string; label: string; value: string };

type RppProjectForDocument = Prisma.RppProjectGetPayload<{
  include: {
    teacherProfile: {
      include: {
        school: true;
      };
    };
    school: true;
    teacherSubject: true;
    teacherClass: true;
  };
}>;

type PdfLine = {
  text: string;
  font: 'F1' | 'F2';
  size: number;
  indent: number;
  color: string;
  lineHeight: number;
  gapBefore: number;
  gapAfter: number;
};

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
    private readonly configService: ConfigService,
  ) {}

  async export(
    user: AuthUser,
    generatedRppId: string,
    fileType: ExportFileType,
  ) {
    const generated = await this.prisma.generatedRpp.findFirst({
      where: {
        id: generatedRppId,
        userId: user.id,
      },
      include: {
        rppProject: {
          include: {
            teacherProfile: {
              include: {
                school: true,
              },
            },
            school: true,
            teacherSubject: true,
            teacherClass: true,
          },
        },
      },
    });

    if (!generated) {
      throw new NotFoundException('Generated RPP tidak ditemukan.');
    }

    const title = generated.rppProject.title;
    const markdown =
      generated.contentMarkdown ||
      this.contentJsonToMarkdown(title, generated.contentJson);
    const identityOverrides = this.buildIdentityOverrides(
      generated.rppProject,
      generated.createdAt,
    );
    const buffer =
      fileType === ExportFileType.pdf
        ? this.renderPdf(title, markdown, identityOverrides)
        : this.renderDocx(title, markdown, identityOverrides);
    const extension = fileType === ExportFileType.pdf ? 'pdf' : 'docx';
    const mimeType =
      fileType === ExportFileType.pdf
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const safeTitle = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    const fileName = `${safeTitle || 'rpp'}-${Date.now()}.${extension}`;
    const filePath = `${user.id}/${generated.rppProjectId}/${fileName}`;
    const bucket =
      this.configService.get<string>('storage.bucketDocuments') ?? 'documents';
    await this.ensureBucket(bucket);

    const { error } = await this.supabaseService
      .getAdminClient()
      .storage.from(bucket)
      .upload(filePath, buffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (error) {
      throw new Error(
        `Gagal upload dokumen ke Supabase Storage: ${error.message}`,
      );
    }

    const { data } = this.supabaseService
      .getAdminClient()
      .storage.from(bucket)
      .getPublicUrl(filePath);

    return this.prisma.exportedDocument.create({
      data: {
        userId: user.id,
        rppProjectId: generated.rppProjectId,
        generatedRppId: generated.id,
        fileType,
        fileName,
        filePath,
        fileUrl: data.publicUrl,
        mimeType,
        sizeBytes: buffer.length,
      },
      include: {
        generatedRpp: true,
      },
    });
  }

  async download(user: AuthUser, documentId: string) {
    const document = await this.prisma.exportedDocument.findFirst({
      where: {
        id: documentId,
        userId: user.id,
      },
    });

    if (!document) {
      throw new NotFoundException('Dokumen tidak ditemukan.');
    }

    const bucket =
      this.configService.get<string>('storage.bucketDocuments') ?? 'documents';
    const { data } = await this.supabaseService
      .getAdminClient()
      .storage.from(bucket)
      .createSignedUrl(document.filePath, 60 * 60);

    return {
      ...document,
      downloadUrl: data?.signedUrl ?? document.fileUrl,
    };
  }

  private contentJsonToMarkdown(title: string, contentJson: unknown): string {
    return `# ${title}\n\n\`\`\`json\n${JSON.stringify(contentJson, null, 2)}\n\`\`\`\n`;
  }

  private async ensureBucket(bucket: string) {
    const storage = this.supabaseService.getAdminClient().storage;
    const existing = await storage.getBucket(bucket);

    if (!existing.error) {
      return;
    }

    const created = await storage.createBucket(bucket, {
      public: true,
      fileSizeLimit:
        (this.configService.get<number>('storage.maxFileSizeMb') ?? 10) *
        1024 *
        1024,
    });

    if (created.error && !/already exists/i.test(created.error.message)) {
      this.logger.error(
        `Gagal membuat bucket dokumen "${bucket}": ${created.error.message}`,
      );
      throw new Error(
        `Gagal membuat bucket dokumen "${bucket}": ${created.error.message}`,
      );
    }
  }

  private renderPdf(
    title: string,
    markdown: string,
    identityOverrides: Record<string, string>,
  ): Buffer {
    const blocks = this.parseMarkdownDocument(
      title,
      markdown,
      identityOverrides,
    );
    const lines = this.blocksToPdfLines(blocks);
    const pages: Array<Array<{ line: PdfLine; y: number }>> = [[]];
    let y = 782;

    for (const line of lines) {
      const requiredHeight = line.gapBefore + line.lineHeight + line.gapAfter;
      if (y - requiredHeight < 54 && pages[pages.length - 1].length > 0) {
        pages.push([]);
        y = 782;
      }

      y -= line.gapBefore;
      pages[pages.length - 1].push({ line, y });
      y -= line.lineHeight + line.gapAfter;
    }

    const objects: string[] = [
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      `2 0 obj << /Type /Pages /Kids [${pages
        .map((_, index) => `${5 + index * 2} 0 R`)
        .join(' ')}] /Count ${pages.length} >> endobj`,
      '3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >> endobj',
    ];

    for (const [pageIndex, pageLines] of pages.entries()) {
      const pageObjectId = 5 + pageIndex * 2;
      const contentObjectId = pageObjectId + 1;
      const escaped = pageLines
        .map(({ line, y }) => {
          const x = 42 + line.indent;
          return `BT ${line.color} rg /${line.font} ${line.size} Tf ${x} ${y} Td (${this.escapePdf(
            line.text,
          )}) Tj ET`;
        })
        .join('\n');

      objects.push(
        `${pageObjectId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >> endobj`,
        `${contentObjectId} 0 obj << /Length ${Buffer.byteLength(
          escaped,
        )} >> stream\n${escaped}\nendstream endobj`,
      );
    }

    let pdf = '%PDF-1.4\n';
    const offsets = [0];
    for (const object of objects) {
      offsets.push(Buffer.byteLength(pdf));
      pdf += `${object}\n`;
    }
    const xrefOffset = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1)) {
      pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
    }
    pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(pdf);
  }

  private renderDocx(
    title: string,
    markdown: string,
    identityOverrides: Record<string, string>,
  ): Buffer {
    const body = this.parseMarkdownDocument(title, markdown, identityOverrides)
      .map((block) => this.renderDocxBlock(block))
      .join('');
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${body}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`;
    return this.zipStore([
      {
        name: '[Content_Types].xml',
        content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
      },
      {
        name: '_rels/.rels',
        content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      },
      {
        name: 'word/document.xml',
        content: documentXml,
      },
    ]);
  }

  private parseMarkdownDocument(
    title: string,
    markdown: string,
    identityOverrides: Record<string, string>,
  ): DocumentBlock[] {
    const lines = this.stripMarkdownMetadata(markdown).split('\n');
    const blocks: DocumentBlock[] = [
      { type: 'title', text: this.cleanInlineText(title) },
    ];

    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = lines[index] ?? '';
      const line = rawLine.trim();

      if (!line || /^-{3,}$/.test(line)) {
        if (blocks[blocks.length - 1]?.type !== 'spacer') {
          blocks.push({ type: 'spacer' });
        }
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = Math.min(heading[1].length, 3) as 1 | 2 | 3;
        const text = this.cleanInlineText(heading[2]);

        if (level === 1 && this.sameTitle(text, title)) {
          continue;
        }

        blocks.push({ type: 'heading', level, text });

        if (/identitas pembelajaran/i.test(text)) {
          const rows: MetadataRow[] = [];
          let nextIndex = index + 1;

          for (; nextIndex < lines.length; nextIndex += 1) {
            const nextLine = (lines[nextIndex] ?? '').trim();
            if (/^#{1,6}\s+/.test(nextLine)) {
              break;
            }
            const row = this.parseMetadataRow(nextLine);
            if (row) {
              rows.push(this.applyMetadataOverride(row, identityOverrides));
            }
          }

          blocks.push({
            type: 'table',
            rows: this.completeIdentityRows(rows, identityOverrides),
          });
          index = nextIndex - 1;
        }

        continue;
      }

      const metadataRow = this.parseMetadataRow(line);
      const lastBlock = blocks[blocks.length - 1];
      if (metadataRow && lastBlock?.type === 'table') {
        lastBlock.rows.push(
          this.applyMetadataOverride(metadataRow, identityOverrides),
        );
        continue;
      }

      if (/^[-*]\s+/.test(line)) {
        const bulletText = this.cleanInlineText(
          line.replace(/^[-*]\s+/, ''),
          true,
        );
        const checklist = this.parseChecklistItem(bulletText);
        if (checklist) {
          blocks.push(checklist);
          continue;
        }

        blocks.push({
          type: 'bullet',
          text: bulletText,
        });
        continue;
      }

      const numbered = line.match(/^\d+[.)]\s+(.+)$/);
      if (numbered) {
        blocks.push({
          type: 'bullet',
          text: this.cleanInlineText(numbered[1], true),
        });
        continue;
      }

      blocks.push({ type: 'paragraph', text: this.cleanInlineText(line, true) });
    }

    return blocks.filter(
      (block, index, all) =>
        block.type !== 'spacer' ||
        (index > 0 && index < all.length - 1 && all[index - 1].type !== 'spacer'),
    );
  }

  private stripMarkdownMetadata(markdown: string): string {
    const trimmed = markdown.replace(/\r/g, '').trim();
    const withoutClosedFrontMatter = trimmed
      .replace(/^---\s*[\s\S]*?\n---\s*/m, '')
      .trim();

    if (withoutClosedFrontMatter !== trimmed) {
      return withoutClosedFrontMatter;
    }

    const firstHeading = trimmed.search(/^#{1,3}\s+/m);
    if (trimmed.startsWith('---') && firstHeading > 0) {
      return trimmed.slice(firstHeading).trim();
    }

    return trimmed;
  }

  private buildIdentityOverrides(
    project: RppProjectForDocument,
    generatedAt: Date,
  ): Record<string, string> {
    const school = project.school ?? project.teacherProfile.school;
    const contextSchoolName = this.findContextString(
      project.teacherProfile.teachingContext,
      ['schoolName', 'namaSekolah', 'school'],
    );
    const contextEducationLevel = this.findContextString(
      project.teacherProfile.teachingContext,
      ['educationLevel', 'jenjangPendidikan', 'schoolLevel'],
    );

    return {
      schoolName: this.cleanMetadataValue(school?.name ?? contextSchoolName ?? ''),
      teacherName: this.cleanMetadataValue(project.teacherProfile.fullName),
      educationLevel: this.formatEducationLevel(
        school?.schoolLevel ??
          contextEducationLevel ??
          project.gradeLevel ??
          project.teacherSubject?.gradeLevel ??
          project.teacherClass?.gradeLevel ??
          '',
      ),
      phase: this.formatPhase(
        project.phase ?? project.teacherSubject?.phase ?? '',
      ),
      gradeLevel: this.cleanMetadataValue(
        project.teacherClass?.className ??
          project.teacherClass?.gradeLevel ??
          project.gradeLevel ??
          '',
      ),
      subject: this.cleanMetadataValue(
        project.subject ?? project.teacherSubject?.subjectName ?? '',
      ),
      topic: this.cleanMetadataValue(project.topic ?? ''),
      timeAllocation: this.formatTimeAllocation(project.totalJp),
      meetingCount: project.meetingCount ? String(project.meetingCount) : '',
      academicYear: this.academicYearFromGeneratedAt(generatedAt),
      rppType: this.formatRppType(project.rppType),
    };
  }

  private completeIdentityRows(
    rows: MetadataRow[],
    identityOverrides: Record<string, string>,
  ): MetadataRow[] {
    const order = [
      'schoolName',
      'teacherName',
      'educationLevel',
      'phase',
      'gradeLevel',
      'subject',
      'topic',
      'element',
      'timeAllocation',
      'meetingCount',
      'academicYear',
      'rppType',
    ];
    const rowByKey = new Map(rows.map((row) => [row.key, row]));

    return order
      .map((key) => {
        const row = rowByKey.get(key);
        if (row) {
          return this.applyMetadataOverride(row, identityOverrides);
        }

        const value = identityOverrides[key];
        if (!value || this.isEmptyMetadataValue(value)) {
          return undefined;
        }

        return {
          key,
          label: this.humanizeMetadataLabel(key),
          value: this.cleanMetadataValue(value),
        };
      })
      .filter((row): row is MetadataRow => Boolean(row));
  }

  private applyMetadataOverride(
    row: MetadataRow,
    identityOverrides: Record<string, string>,
  ): MetadataRow {
    const override = identityOverrides[row.key];

    if (override && this.isEmptyMetadataValue(row.value)) {
      return {
        ...row,
        value: this.cleanMetadataValue(override),
      };
    }

    if (row.key === 'academicYear' && override) {
      return {
        ...row,
        value: this.cleanMetadataValue(override),
      };
    }

    return {
      ...row,
      value: this.cleanMetadataValue(row.value),
    };
  }

  private parseMetadataRow(
    line: string,
  ): MetadataRow | undefined {
    const cleaned = line.replace(/^[-*]\s+/, '').trim();
    const match = cleaned.match(/^([A-Za-z][\w\s./()-]{1,42}):\s*(.*)$/);
    if (!match) {
      return undefined;
    }
    const key = this.normalizeMetadataKey(match[1]);

    return {
      key,
      label: this.humanizeMetadataLabel(key),
      value: this.cleanMetadataValue(match[2]),
    };
  }

  private normalizeMetadataKey(label: string): string {
    const normalized = label
      .replace(/_/g, '')
      .replace(/\s+/g, '')
      .toLowerCase();
    const aliases: Record<string, string> = {
      schoolname: 'schoolName',
      namasekolah: 'schoolName',
      teachername: 'teacherName',
      namaguru: 'teacherName',
      educationlevel: 'educationLevel',
      jenjangpendidikan: 'educationLevel',
      phase: 'phase',
      fase: 'phase',
      gradelevel: 'gradeLevel',
      kelas: 'gradeLevel',
      subject: 'subject',
      matapelajaran: 'subject',
      topic: 'topic',
      topik: 'topic',
      element: 'element',
      elemen: 'element',
      timeallocation: 'timeAllocation',
      alokasiwaktu: 'timeAllocation',
      meetingcount: 'meetingCount',
      jumlahpertemuan: 'meetingCount',
      academicyear: 'academicYear',
      tahunajaran: 'academicYear',
      rpptype: 'rppType',
      jenisrpp: 'rppType',
    };

    return aliases[normalized] ?? label.replace(/\s+/g, '');
  }

  private humanizeMetadataLabel(label: string): string {
    const normalized = this.normalizeMetadataKey(label);
    const labels: Record<string, string> = {
      schoolName: 'Nama Sekolah',
      teacherName: 'Nama Guru',
      educationLevel: 'Jenjang Pendidikan',
      phase: 'Fase',
      gradeLevel: 'Kelas',
      subject: 'Mata Pelajaran',
      topic: 'Topik',
      element: 'Elemen',
      timeAllocation: 'Alokasi Waktu',
      meetingCount: 'Jumlah Pertemuan',
      academicYear: 'Tahun Ajaran',
      rppType: 'Jenis RPP',
    };

    return (
      labels[normalized] ??
      label
        .replace(/_/g, ' ')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    );
  }

  private cleanMetadataValue(value: string): string {
    const cleaned = this.cleanInlineText(value);
    if (this.isEmptyMetadataValue(cleaned)) {
      return '-';
    }
    return cleaned;
  }

  private isEmptyMetadataValue(value: string): boolean {
    const cleaned = value.trim();
    return !cleaned || /^[-–—]$/.test(cleaned) || /^(none|null|undefined)$/i.test(cleaned);
  }

  private formatEducationLevel(value: string): string {
    const cleaned = this.cleanMetadataValue(value);
    return /^(sd|mi|smp|mts|sma|ma|smk|mak)$/i.test(cleaned)
      ? cleaned.toUpperCase()
      : cleaned;
  }

  private formatPhase(value: string): string {
    const cleaned = this.cleanMetadataValue(value);
    if (this.isEmptyMetadataValue(cleaned)) {
      return '';
    }
    return /^fase\s+/i.test(cleaned)
      ? cleaned.replace(/^fase\s+([a-z])/i, (_, letter: string) => `Fase ${letter.toUpperCase()}`)
      : `Fase ${cleaned.toUpperCase()}`;
  }

  private formatRppType(value: string): string {
    if (value === 'intrakurikuler') {
      return 'Intrakurikuler';
    }
    if (value === 'pjbl_kokurikuler') {
      return 'PjBL Kokurikuler';
    }
    return this.cleanMetadataValue(value);
  }

  private formatTimeAllocation(totalJp: number | null): string {
    if (!totalJp) {
      return '';
    }
    return `${totalJp} JP`;
  }

  private academicYearFromGeneratedAt(generatedAt: Date): string {
    const year = generatedAt.getFullYear();
    return `${year}/${year + 1}`;
  }

  private findContextString(
    value: unknown,
    keys: string[],
  ): string | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = this.findContextString(item, keys);
        if (found) {
          return found;
        }
      }
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const normalizedKeys = keys.map((key) => key.toLowerCase());

    for (const [key, item] of Object.entries(record)) {
      if (!normalizedKeys.includes(key.toLowerCase())) {
        continue;
      }

      if (typeof item === 'string' && item.trim()) {
        return item.trim();
      }

      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const nestedName = (item as Record<string, unknown>).name;
        if (typeof nestedName === 'string' && nestedName.trim()) {
          return nestedName.trim();
        }
      }
    }

    for (const item of Object.values(record)) {
      const found = this.findContextString(item, keys);
      if (found) {
        return found;
      }
    }

    return undefined;
  }

  private cleanInlineText(value: string, preserveBold = false): string {
    let cleaned = value
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2');

    if (!preserveBold) {
      cleaned = cleaned.replace(/\*\*([^*\n]+)\*\*/g, '$1');
    }

    return cleaned.replace(/\s+/g, ' ').trim();
  }

  private parseChecklistItem(text: string): DocumentBlock | undefined {
    const checkbox = text.match(/^(\[[ xX]\]|☐|☑)\s+(.+)$/);
    if (checkbox) {
      return {
        type: 'checklist',
        checked: /\[[xX]\]|☑/.test(checkbox[1]),
        text: this.cleanInlineText(checkbox[2], true),
      };
    }

    const booleanStatus = text.match(/^(.+?):\s*(true|false)$/i);
    if (booleanStatus) {
      return {
        type: 'checklist',
        checked: booleanStatus[2].toLowerCase() === 'true',
        text: this.cleanInlineText(booleanStatus[1], true),
      };
    }

    return undefined;
  }

  private sameTitle(value: string, title: string): boolean {
    const normalize = (text: string) =>
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .trim();
    return normalize(value) === normalize(title);
  }

  private renderDocxBlock(block: DocumentBlock): string {
    if (block.type === 'title') {
      return this.renderDocxParagraph(block.text, {
        bold: true,
        color: 'DC2626',
        fontSize: 34,
        spacingAfter: 220,
      });
    }

    if (block.type === 'heading') {
      const headingOptions =
        block.level === 1
          ? { fontSize: 28, spacingBefore: 180, spacingAfter: 130 }
          : block.level === 2
            ? { fontSize: 24, spacingBefore: 170, spacingAfter: 110 }
            : { fontSize: 21, spacingBefore: 140, spacingAfter: 90 };

      return this.renderDocxParagraph(block.text, {
        ...headingOptions,
        bold: true,
        color: block.level === 3 ? '334155' : 'B91C1C',
        bottomBorder: block.level <= 2,
      });
    }

    if (block.type === 'table') {
      return this.renderDocxTable(block.rows);
    }

    if (block.type === 'bullet') {
      return this.renderDocxParagraph(block.text, {
        bullet: true,
        fontSize: 21,
        spacingAfter: 70,
      });
    }

    if (block.type === 'checklist') {
      return this.renderDocxParagraph(
        `${block.checked ? '☑' : '☐'} ${block.text}`,
        {
          fontSize: 21,
          spacingAfter: 70,
        },
      );
    }

    if (block.type === 'spacer') {
      return this.renderDocxParagraph('', { spacingAfter: 80 });
    }

    return this.renderDocxParagraph(block.text, {
      fontSize: 21,
      justify: true,
      spacingAfter: 90,
    });
  }

  private renderDocxParagraph(
    text: string,
    options: {
      bold?: boolean;
      bullet?: boolean;
      color?: string;
      fontSize?: number;
      justify?: boolean;
      spacingBefore?: number;
      spacingAfter?: number;
      bottomBorder?: boolean;
    } = {},
  ): string {
    const size = options.fontSize ?? 22;
    const paragraphProperties = [
      `<w:spacing w:before="${options.spacingBefore ?? 0}" w:after="${
        options.spacingAfter ?? 80
      }" w:line="276" w:lineRule="auto"/>`,
      options.justify ? '<w:jc w:val="both"/>' : '',
      options.bullet ? '<w:ind w:left="360" w:hanging="180"/>' : '',
      options.bottomBorder
        ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="FCA5A5"/></w:pBdr>'
        : '',
    ].join('');
    const bulletPrefix = options.bullet ? '• ' : '';

    return `<w:p><w:pPr>${paragraphProperties}</w:pPr>${this.renderDocxRuns(
      `${bulletPrefix}${text}`,
      {
        bold: options.bold,
        color: options.color ?? '1E293B',
        size,
      },
    )}</w:p>`;
  }

  private renderDocxRuns(
    text: string,
    options: { bold?: boolean; color: string; size: number },
  ): string {
    return this.parseInlineSegments(text)
      .map((segment) => {
        const runProperties = [
          '<w:rFonts w:ascii="Aptos" w:hAnsi="Aptos" w:cs="Aptos"/>',
          options.bold || segment.bold ? '<w:b/><w:bCs/>' : '',
          `<w:color w:val="${options.color}"/>`,
          `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>`,
          '<w:lang w:val="id-ID"/>',
        ].join('');

        return `<w:r><w:rPr>${runProperties}</w:rPr><w:t xml:space="preserve">${this.escapeXml(
          segment.text,
        )}</w:t></w:r>`;
      })
      .join('');
  }

  private parseInlineSegments(text: string): Array<{ text: string; bold: boolean }> {
    const segments: Array<{ text: string; bold: boolean }> = [];
    const pattern = /\*\*([^*\n]+)\*\*/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(text)) !== null) {
      if (match.index > cursor) {
        segments.push({
          text: this.cleanInlineSegment(text.slice(cursor, match.index)),
          bold: false,
        });
      }

      segments.push({
        text: this.cleanInlineText(match[1]),
        bold: true,
      });
      cursor = match.index + match[0].length;
    }

    if (cursor < text.length) {
      segments.push({
        text: this.cleanInlineSegment(text.slice(cursor)),
        bold: false,
      });
    }

    return segments.length > 0
      ? segments.filter((segment) => segment.text.length > 0)
      : [{ text: this.cleanInlineText(text), bold: false }];
  }

  private cleanInlineSegment(value: string): string {
    return value
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/[ \t]+/g, ' ');
  }

  private renderDocxTable(
    rows: Array<{ label: string; value: string }>,
  ): string {
    const tableRows = rows
      .map(
        (row) =>
          `<w:tr>${this.renderDocxTableCell(row.label, {
            bold: true,
            fill: 'FEF2F2',
            width: 3000,
          })}${this.renderDocxTableCell(row.value, {
            width: 5900,
          })}</w:tr>`,
      )
      .join('');

    return `<w:tbl><w:tblPr><w:tblW w:w="8900" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="FECACA"/><w:left w:val="single" w:sz="4" w:color="FECACA"/><w:bottom w:val="single" w:sz="4" w:color="FECACA"/><w:right w:val="single" w:sz="4" w:color="FECACA"/><w:insideH w:val="single" w:sz="4" w:color="FECACA"/><w:insideV w:val="single" w:sz="4" w:color="FECACA"/></w:tblBorders><w:tblCellMar><w:top w:w="120" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tblCellMar></w:tblPr>${tableRows}</w:tbl>`;
  }

  private renderDocxTableCell(
    text: string,
    options: { bold?: boolean; fill?: string; width: number },
  ): string {
    const shading = options.fill ? `<w:shd w:fill="${options.fill}"/>` : '';
    return `<w:tc><w:tcPr><w:tcW w:w="${options.width}" w:type="dxa"/>${shading}</w:tcPr>${this.renderDocxParagraph(
      text,
      {
        bold: options.bold,
        fontSize: 20,
        spacingAfter: 0,
      },
    )}</w:tc>`;
  }

  private blocksToPdfLines(blocks: DocumentBlock[]): PdfLine[] {
    const lines: PdfLine[] = [];

    for (const block of blocks) {
      if (block.type === 'spacer') {
        lines.push(this.pdfLine(' ', { gapAfter: 4 }));
        continue;
      }

      if (block.type === 'title') {
        lines.push(
          ...this.wrapPdfLine(block.text, 54).map((text, index) =>
            this.pdfLine(text, {
              font: 'F2',
              size: 20,
              color: '0.86 0.15 0.15',
              lineHeight: 23,
              gapBefore: index === 0 ? 0 : 0,
              gapAfter: index === 0 ? 4 : 0,
            }),
          ),
        );
        continue;
      }

      if (block.type === 'heading') {
        const size = block.level === 1 ? 16 : block.level === 2 ? 14 : 12;
        lines.push(
          ...this.wrapPdfLine(block.text, block.level === 1 ? 62 : 70).map(
            (text, index) =>
              this.pdfLine(text, {
                font: 'F2',
                size,
                color: block.level === 3 ? '0.20 0.25 0.33' : '0.73 0.11 0.11',
                lineHeight: size + 5,
                gapBefore: index === 0 ? 10 : 0,
                gapAfter: index === 0 ? 3 : 0,
              }),
          ),
        );
        continue;
      }

      if (block.type === 'table') {
        for (const row of block.rows) {
          lines.push(
            ...this.wrapPdfLine(`${row.label}: ${row.value}`, 76).map(
              (text, index) =>
                this.pdfLine(text, {
                  font: index === 0 ? 'F2' : 'F1',
                  size: 10,
                  indent: 14,
                  color: '0.15 0.18 0.25',
                  lineHeight: 14,
                  gapAfter: index === 0 ? 1 : 0,
                }),
            ),
          );
        }
        continue;
      }

      if (block.type === 'bullet') {
        lines.push(
          ...this.wrapPdfLine(`- ${block.text}`, 78).map((text, index) =>
            this.pdfLine(text, {
              size: 10,
              indent: index === 0 ? 14 : 24,
              lineHeight: 14,
              gapAfter: index === 0 ? 1 : 0,
            }),
          ),
        );
        continue;
      }

      if (block.type === 'checklist') {
        lines.push(
          ...this.wrapPdfLine(
            `${block.checked ? '[x]' : '[ ]'} ${block.text}`,
            78,
          ).map((text, index) =>
            this.pdfLine(text, {
              size: 10,
              indent: index === 0 ? 14 : 24,
              lineHeight: 14,
              gapAfter: index === 0 ? 1 : 0,
            }),
          ),
        );
        continue;
      }

      lines.push(
        ...this.wrapPdfLine(block.text, 84).map((text, index) =>
          this.pdfLine(text, {
            size: 10,
            lineHeight: 14,
            gapAfter: index === 0 ? 2 : 0,
          }),
        ),
      );
    }

    return lines;
  }

  private pdfLine(
    text: string,
    options: Partial<Omit<PdfLine, 'text'>> = {},
  ): PdfLine {
    return {
      text: this.cleanInlineText(text),
      font: options.font ?? 'F1',
      size: options.size ?? 10,
      indent: options.indent ?? 0,
      color: options.color ?? '0.12 0.16 0.23',
      lineHeight: options.lineHeight ?? 14,
      gapBefore: options.gapBefore ?? 0,
      gapAfter: options.gapAfter ?? 0,
    };
  }

  private wrapPdfLine(line: string, width: number): string[] {
    const words = line.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      return [' '];
    }

    const lines: string[] = [];
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length > width && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }

    if (current) {
      lines.push(current);
    }
    return lines;
  }

  private wrapLine(line: string, width: number): string[] {
    if (line.length <= width) {
      return [line];
    }
    const chunks: string[] = [];
    for (let i = 0; i < line.length; i += width) {
      chunks.push(line.slice(i, i + width));
    }
    return chunks;
  }

  private escapePdf(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)');
  }

  private escapeXml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private zipStore(files: Array<{ name: string; content: string }>): Buffer {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const file of files) {
      const name = Buffer.from(file.name);
      const data = Buffer.from(file.content);
      const crc = this.crc32(data);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0, 6);
      local.writeUInt16LE(0, 8);
      local.writeUInt16LE(0, 10);
      local.writeUInt16LE(0, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      localParts.push(local, name, data);

      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(20, 4);
      central.writeUInt16LE(20, 6);
      central.writeUInt16LE(0, 8);
      central.writeUInt16LE(0, 10);
      central.writeUInt16LE(0, 12);
      central.writeUInt16LE(0, 14);
      central.writeUInt32LE(crc, 16);
      central.writeUInt32LE(data.length, 20);
      central.writeUInt32LE(data.length, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt16LE(0, 30);
      central.writeUInt16LE(0, 32);
      central.writeUInt16LE(0, 34);
      central.writeUInt16LE(0, 36);
      central.writeUInt32LE(0, 38);
      central.writeUInt32LE(offset, 42);
      centralParts.push(central, name);
      offset += local.length + name.length + data.length;
    }

    const central = Buffer.concat(centralParts);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(central.length, 12);
    end.writeUInt32LE(offset, 16);
    end.writeUInt16LE(0, 20);

    return Buffer.concat([...localParts, central, end]);
  }

  private crc32(buffer: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let i = 0; i < 8; i += 1) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
}
