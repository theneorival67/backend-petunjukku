import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExportFileType, Prisma } from '@prisma/client';
import { execFile } from 'child_process';
import { existsSync, promises as fs, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { promisify } from 'util';
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

type PdfCoverImage = {
  width: number;
  height: number;
  colorSpace: 'DeviceGray' | 'DeviceRGB';
  colors: 1 | 3;
  bitsPerComponent: number;
  data: Buffer;
};

type DocxZipFile = { name: string; content: string | Buffer };

type LkpdDocumentData = {
  title: string;
  schoolName: string;
  classSemester: string;
  material: string;
  timeAllocation: string;
  indicators: string[];
  objectives: string[];
  instructions: string[];
  supportingInformation: string[];
  workSteps: string[];
  questions: string[];
};

const DOCX_PAGE_WIDTH_TWIPS = 11906;
const DOCX_PAGE_HEIGHT_TWIPS = 16838;
const DOCX_PAGE_WIDTH_EMU = DOCX_PAGE_WIDTH_TWIPS * 635;
const DOCX_PAGE_HEIGHT_EMU = DOCX_PAGE_HEIGHT_TWIPS * 635;
const TEMPLATE_BLUE = '1F497D';
const TEMPLATE_DARK = '232D34';
const TEMPLATE_DARK_BLUE = '1C3556';
const TEMPLATE_GREEN = '2F6B3D';
const TEMPLATE_GOLD = 'D18A4B';
const TEMPLATE_ORANGE = 'F28C38';
const TEMPLATE_TABLE_BORDER = 'DDE7E2';
const TEMPLATE_TABLE_FILL = 'F7F9F8';
const execFileAsync = promisify(execFile);

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
    documentKind: 'rpp' | 'lkpd' = 'rpp',
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

    if (
      documentKind === 'lkpd' &&
      generated.rppProject.rppType !== 'intrakurikuler'
    ) {
      throw new BadRequestException(
        'Dokumen LKPD saat ini hanya tersedia untuk RPP intrakurikuler.',
      );
    }

    const title = generated.rppProject.title;
    const markdown =
      generated.contentMarkdown ||
      this.contentJsonToMarkdown(title, generated.contentJson);
    const identityOverrides = this.buildIdentityOverrides(
      generated.rppProject,
      generated.createdAt,
    );
    const lkpdData =
      documentKind === 'lkpd'
        ? this.buildLkpdDocumentData(generated.contentJson, identityOverrides)
        : undefined;
    const buffer =
      documentKind === 'lkpd' && lkpdData
        ? fileType === ExportFileType.pdf
          ? await this.renderLkpdPdf(lkpdData)
          : this.renderLkpdDocx(lkpdData)
        : fileType === ExportFileType.pdf
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
    const fileName = `${documentKind === 'lkpd' ? 'lkpd-' : ''}${
      safeTitle || 'rpp'
    }-${Date.now()}.${extension}`;
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

    const coverImage = this.loadPdfCoverImage();
    const objects = new Map<number, Buffer>();
    const pageObjectIds: number[] = [];
    let nextObjectId = 5;

    if (coverImage) {
      const imageObjectId = nextObjectId++;
      const coverPageObjectId = nextObjectId++;
      const coverContentObjectId = nextObjectId++;
      pageObjectIds.push(coverPageObjectId);

      objects.set(
        imageObjectId,
        this.pdfStreamObject(
          imageObjectId,
          `<< /Type /XObject /Subtype /Image /Width ${coverImage.width} /Height ${coverImage.height} /ColorSpace /${coverImage.colorSpace} /BitsPerComponent ${coverImage.bitsPerComponent} /Filter /FlateDecode /DecodeParms << /Predictor 15 /Colors ${coverImage.colors} /BitsPerComponent ${coverImage.bitsPerComponent} /Columns ${coverImage.width} >> /Interpolate true /Length ${coverImage.data.length} >>`,
          coverImage.data,
        ),
      );
      const coverContent = this.renderPdfCoverContent(title, identityOverrides);
      objects.set(
        coverContentObjectId,
        this.pdfStreamObject(
          coverContentObjectId,
          `<< /Length ${coverContent.length} >>`,
          coverContent,
        ),
      );
      objects.set(
        coverPageObjectId,
        this.pdfObject(
          coverPageObjectId,
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << /ImCover ${imageObjectId} 0 R >> >> /Contents ${coverContentObjectId} 0 R >>`,
        ),
      );
    }

    for (const pageLines of pages) {
      const pageObjectId = nextObjectId++;
      const contentObjectId = nextObjectId++;
      pageObjectIds.push(pageObjectId);
      const escaped = pageLines
        .map(({ line, y }) => {
          const x = 42 + line.indent;
          return `BT ${line.color} rg /${line.font} ${line.size} Tf ${x} ${y} Td (${this.escapePdf(
            line.text,
          )}) Tj ET`;
        })
        .join('\n');

      objects.set(
        pageObjectId,
        this.pdfObject(
          pageObjectId,
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
        ),
      );
      objects.set(
        contentObjectId,
        this.pdfStreamObject(
          contentObjectId,
          `<< /Length ${Buffer.byteLength(escaped)} >>`,
          Buffer.from(escaped),
        ),
      );
    }

    objects.set(1, this.pdfObject(1, '<< /Type /Catalog /Pages 2 0 R >>'));
    objects.set(
      2,
      this.pdfObject(
        2,
        `<< /Type /Pages /Kids [${pageObjectIds
          .map((objectId) => `${objectId} 0 R`)
          .join(' ')}] /Count ${pageObjectIds.length} >>`,
      ),
    );
    objects.set(
      3,
      this.pdfObject(
        3,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      ),
    );
    objects.set(
      4,
      this.pdfObject(
        4,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
      ),
    );

    return this.buildPdfBuffer(
      Array.from({ length: nextObjectId - 1 }, (_, index) => {
        const objectId = index + 1;
        const object = objects.get(objectId);
        if (!object) {
          throw new Error(`Objek PDF ${objectId} tidak ditemukan.`);
        }
        return object;
      }),
    );
  }

  private renderDocx(
    title: string,
    markdown: string,
    identityOverrides: Record<string, string>,
  ): Buffer {
    const blocks = this.parseMarkdownDocument(
      title,
      markdown,
      identityOverrides,
    );
    const contentBlocks = blocks.filter((block) => block.type !== 'title');
    const coverImage = this.loadCoverImage();
    const body = contentBlocks
      .map((block) => this.renderDocxBlock(block))
      .join('');
    const documentRelationships = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${coverImage ? '<Relationship Id="rIdCoverImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/cover.png"/>' : ''}<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`;
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
${this.renderDocxCover(title, identityOverrides, Boolean(coverImage))}
${this.renderDocxTableOfContents(contentBlocks)}
${body}
<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
</w:body></w:document>`;
    const files: DocxZipFile[] = [
      {
        name: '[Content_Types].xml',
        content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${coverImage ? '<Default Extension="png" ContentType="image/png"/>' : ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`,
      },
      {
        name: '_rels/.rels',
        content: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
      },
      ...(coverImage
        ? [
            {
              name: 'word/media/cover.png',
              content: coverImage,
            },
          ]
        : []),
      {
        name: 'word/_rels/document.xml.rels',
        content: documentRelationships,
      },
      {
        name: 'word/footer1.xml',
        content: this.renderDocxFooter(title, identityOverrides),
      },
      {
        name: 'word/document.xml',
        content: documentXml,
      },
    ];
    return this.zipStore(files);
  }

  private buildLkpdDocumentData(
    contentJson: unknown,
    identityOverrides: Record<string, string>,
  ): LkpdDocumentData {
    const content = this.recordValue(contentJson);
    const identity = this.recordValue(content.identity);
    const direction = this.recordValue(content.profileAndLearningDirection);
    const assessment = this.recordValue(content.assessment);
    const summative = this.recordValue(assessment.summative);
    const material =
      this.nonEmptyText(identity.topic) ||
      this.nonEmptyText(identityOverrides.topic) ||
      'Materi Pembelajaran';
    const objectives = this.stringList(direction.learningObjectives);
    const normalizedObjectives =
      objectives.length > 0
        ? objectives
        : [
            `Murid mampu menjelaskan konsep utama ${material}.`,
            `Murid mampu menerapkan ${material} dalam situasi di lingkungan sekitar.`,
          ];
    const sampleTasks = this.stringList(summative.sampleTasks);
    const essentialQuestion = this.nonEmptyText(direction.essentialQuestion);

    return {
      title: material,
      schoolName:
        this.nonEmptyText(identity.schoolName) ||
        this.nonEmptyText(identityOverrides.schoolName) ||
        'Satuan Pendidikan',
      classSemester:
        this.nonEmptyText(identity.gradeLevel) ||
        this.nonEmptyText(identityOverrides.gradeLevel) ||
        'Kelas / Semester',
      material,
      timeAllocation:
        this.nonEmptyText(identity.timeAllocation) ||
        this.nonEmptyText(identityOverrides.timeAllocation) ||
        '2 JP',
      indicators: normalizedObjectives.slice(0, 3),
      objectives: normalizedObjectives.slice(0, 2),
      instructions: [
        'Berdoalah sebelum mulai mengerjakan.',
        'Bacalah Informasi Pendukung terlebih dahulu.',
        'Kerjakan bersama kelompokmu dan saling menghargai pendapat.',
        'Tulis jawaban pada tempat yang tersedia dengan rapi.',
        'Tanyakan kepada gurumu bila ada yang belum jelas.',
      ],
      supportingInformation: [
        this.nonEmptyText(content.materialContext) ||
          `${material} berkaitan erat dengan kehidupan sehari-hari. Memahami konsep, penyebab, dampak, dan penerapannya membantu murid mengambil keputusan yang tepat berdasarkan informasi yang tersedia.`,
        `Bacalah informasi tersebut sebagai bahan untuk mengerjakan soal. Diskusikan hubungan materi dengan situasi di lingkungan sekitar, lalu tuliskan hasil analisismu secara runtut.`,
      ],
      workSteps: [
        'Baca Informasi Pendukung bersama kelompokmu.',
        `Amati contoh atau situasi yang berkaitan dengan ${material}.`,
        'Diskusikan jawaban soal-soal di bawah ini.',
        'Tuliskan hasil diskusi pada tempat yang tersedia.',
        'Sampaikan hasil kerja kelompokmu di depan kelas.',
      ],
      questions: [
        sampleTasks[0] ||
          essentialQuestion ||
          `Jelaskan dengan bahasamu sendiri apa yang dimaksud dengan ${material}.`,
        sampleTasks[1] ||
          `Sebutkan tiga contoh yang berkaitan dengan ${material} beserta penjelasannya.`,
        sampleTasks[2] ||
          'Berdasarkan informasi pendukung, lengkapi tabel analisis berikut.',
        sampleTasks[3] ||
          `Tuliskan satu tindakan atau kesimpulan yang dapat kamu lakukan setelah mempelajari ${material}.`,
      ],
    };
  }

  private recordValue(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private nonEmptyText(value: unknown): string {
    return typeof value === 'string' && value.trim() ? value.trim() : '';
  }

  private stringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => {
        if (typeof item === 'string') {
          return item.trim();
        }
        const record = this.recordValue(item);
        return (
          this.nonEmptyText(record.description) ||
          this.nonEmptyText(record.prompt)
        );
      })
      .filter(Boolean);
  }

  private renderLkpdDocx(data: LkpdDocumentData): Buffer {
    const pageOne = [
      this.renderLkpdParagraph('LEMBAR KERJA PESERTA DIDIK (LKPD)', {
        align: 'center',
        bold: true,
        color: '163E68',
        size: 24,
        spacingAfter: 60,
      }),
      this.renderLkpdParagraph(data.title, {
        align: 'center',
        bold: true,
        color: '505A63',
        size: 18,
        spacingAfter: 130,
        bottomBorder: true,
      }),
      this.renderLkpdMetadataTable([
        ['Satuan Pendidikan', data.schoolName],
        ['Kelas / Semester', data.classSemester],
        ['Materi Ajar', data.material],
        ['Alokasi Waktu', data.timeAllocation],
      ]),
      this.renderLkpdParagraph('Identitas Murid', {
        bold: true,
        spacingBefore: 80,
        spacingAfter: 40,
      }),
      this.renderLkpdStudentIdentityTable(),
      this.renderLkpdSpacer(180),
      this.renderLkpdSection(
        'A',
        'Indikator Pencapaian Kompetensi',
        this.renderLkpdNumberedList(data.indicators),
      ),
      this.renderLkpdSpacer(130),
      this.renderLkpdSection(
        'B',
        'Tujuan Pembelajaran',
        this.renderLkpdNumberedList(data.objectives),
      ),
      this.renderLkpdSpacer(130),
      this.renderLkpdSection(
        'C',
        'Petunjuk Belajar',
        data.instructions
          .map((item) => this.renderLkpdParagraph(`•  ${item}`))
          .join(''),
      ),
      this.renderLkpdSpacer(130),
      this.renderLkpdSection('D', 'Informasi Pendukung', ''),
      this.renderDocxPageBreak(),
    ].join('');

    const pageTwo = [
      this.renderLkpdBox(
        data.supportingInformation
          .map((item, index) =>
            this.renderLkpdParagraph(item, {
              bold: index === 1,
              justify: true,
              spacingAfter: index === 0 ? 100 : 0,
            }),
          )
          .join(''),
      ),
      this.renderLkpdSpacer(180),
      this.renderLkpdSection(
        'E',
        'Langkah-langkah Kerja',
        this.renderLkpdNumberedList(data.workSteps),
      ),
      this.renderLkpdSpacer(180),
      this.renderLkpdFirstQuestionSection(data.questions[0]),
      this.renderDocxPageBreak(),
    ].join('');

    const pageThree = [
      this.renderLkpdParagraph(`Soal 2. ${data.questions[1]}`, {
        bold: true,
        spacingAfter: 40,
      }),
      this.renderLkpdAnswerArea(1900),
      this.renderLkpdSpacer(130),
      this.renderLkpdParagraph(`Soal 3. ${data.questions[2]}`, {
        bold: true,
        spacingAfter: 70,
      }),
      this.renderLkpdQuestionTable(),
      this.renderLkpdSpacer(180),
      this.renderLkpdParagraph(`Soal 4. ${data.questions[3]}`, {
        bold: true,
        spacingAfter: 40,
      }),
      this.renderLkpdAnswerArea(2800),
    ].join('');

    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
${pageOne}${pageTwo}${pageThree}
<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="${DOCX_PAGE_WIDTH_TWIPS}" w:h="${DOCX_PAGE_HEIGHT_TWIPS}"/><w:pgMar w:top="720" w:right="900" w:bottom="900" w:left="900" w:header="360" w:footer="420" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;

    return this.zipStore([
      {
        name: '[Content_Types].xml',
        content:
          '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>',
      },
      {
        name: '_rels/.rels',
        content:
          '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      },
      {
        name: 'word/_rels/document.xml.rels',
        content:
          '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>',
      },
      {
        name: 'word/footer1.xml',
        content: this.renderLkpdFooter(data.title),
      },
      {
        name: 'word/document.xml',
        content: documentXml,
      },
    ]);
  }

  private async renderLkpdPdf(data: LkpdDocumentData): Promise<Buffer> {
    const directory = await fs.mkdtemp(join(tmpdir(), 'petunjukku-lkpd-'));
    const docxPath = join(directory, 'lkpd.docx');
    const pdfPath = join(directory, 'lkpd.pdf');

    try {
      await fs.writeFile(docxPath, this.renderLkpdDocx(data));
      await execFileAsync('libreoffice', [
        '--headless',
        '--convert-to',
        'pdf',
        '--outdir',
        directory,
        docxPath,
      ]);
      return await fs.readFile(pdfPath);
    } catch (error) {
      this.logger.error(
        `Gagal merender preview PDF LKPD: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new Error(
        'Preview PDF LKPD belum bisa dibuat. Pastikan LibreOffice tersedia.',
      );
    } finally {
      await fs.rm(directory, { force: true, recursive: true });
    }
  }

  private renderLkpdParagraph(
    text: string,
    options: {
      align?: 'left' | 'center' | 'both';
      bold?: boolean;
      bottomBorder?: boolean;
      color?: string;
      justify?: boolean;
      size?: number;
      spacingBefore?: number;
      spacingAfter?: number;
    } = {},
  ): string {
    const size = options.size ?? 18;
    const paragraphProperties = [
      `<w:spacing w:before="${options.spacingBefore ?? 0}" w:after="${
        options.spacingAfter ?? 45
      }" w:line="240" w:lineRule="auto"/>`,
      options.align
        ? `<w:jc w:val="${options.align}"/>`
        : options.justify
          ? '<w:jc w:val="both"/>'
          : '',
      options.bottomBorder
        ? '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="000000"/></w:pBdr>'
        : '',
    ].join('');
    const runProperties = [
      '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>',
      options.bold ? '<w:b/><w:bCs/>' : '',
      `<w:color w:val="${options.color ?? '000000'}"/>`,
      `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`,
      '<w:lang w:val="id-ID"/>',
    ].join('');

    return `<w:p><w:pPr>${paragraphProperties}</w:pPr><w:r><w:rPr>${runProperties}</w:rPr><w:t xml:space="preserve">${this.escapeXml(
      text,
    )}</w:t></w:r></w:p>`;
  }

  private renderLkpdSpacer(height: number): string {
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="${height}"/></w:pPr></w:p>`;
  }

  private renderLkpdTable(rows: string, grid: number[], width = 9300): string {
    return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B9D6CD"/><w:left w:val="single" w:sz="4" w:color="B9D6CD"/><w:bottom w:val="single" w:sz="4" w:color="B9D6CD"/><w:right w:val="single" w:sz="4" w:color="B9D6CD"/><w:insideH w:val="single" w:sz="4" w:color="B9D6CD"/><w:insideV w:val="single" w:sz="4" w:color="B9D6CD"/></w:tblBorders><w:tblCellMar><w:top w:w="45" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="45" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid
      .map((item) => `<w:gridCol w:w="${item}"/>`)
      .join('')}</w:tblGrid>${rows}</w:tbl>`;
  }

  private renderLkpdCell(
    content: string,
    options: {
      fill?: string;
      height?: number;
      width: number;
    },
  ): string {
    return `<w:tc><w:tcPr><w:tcW w:w="${options.width}" w:type="dxa"/>${
      options.fill ? `<w:shd w:fill="${options.fill}"/>` : ''
    }${options.height ? `<w:tcMar/><w:vAlign w:val="top"/>` : ''}</w:tcPr>${content}</w:tc>`;
  }

  private renderLkpdMetadataTable(rows: Array<[string, string]>): string {
    return this.renderLkpdTable(
      rows
        .map(
          ([label, value]) =>
            `<w:tr>${this.renderLkpdCell(
              this.renderLkpdParagraph(label, {
                bold: true,
                color: '254664',
                spacingAfter: 0,
              }),
              { fill: 'F4F7F7', width: 4650 },
            )}${this.renderLkpdCell(
              this.renderLkpdParagraph(value, { spacingAfter: 0 }),
              { width: 4650 },
            )}</w:tr>`,
        )
        .join(''),
      [4650, 4650],
    );
  }

  private renderLkpdStudentIdentityTable(): string {
    const row = (left: string, right: string) =>
      `<w:tr>${this.renderLkpdCell(
        this.renderLkpdParagraph(left, {
          bold: true,
          color: '254664',
          spacingAfter: 0,
        }),
        { fill: 'F4F7F7', width: 2100 },
      )}${this.renderLkpdCell(
        this.renderLkpdParagraph('', { spacingAfter: 0 }),
        {
          width: 2550,
        },
      )}${this.renderLkpdCell(
        this.renderLkpdParagraph(right, {
          bold: true,
          color: '254664',
          spacingAfter: 0,
        }),
        { fill: 'F4F7F7', width: 1800 },
      )}${this.renderLkpdCell(
        this.renderLkpdParagraph('', { spacingAfter: 0 }),
        {
          width: 2850,
        },
      )}</w:tr>`;

    return this.renderLkpdTable(
      `${row('Nama', 'Kelas')}${row('No. Absen', 'Kelompok')}`,
      [2100, 2550, 1800, 2850],
    );
  }

  private renderLkpdSection(
    label: string,
    title: string,
    content: string,
  ): string {
    const header = this.renderLkpdCell(
      this.renderLkpdParagraph(`${label}.  ${title}`, {
        bold: true,
        color: '254664',
        spacingAfter: 0,
      }),
      { fill: 'EAF5F7', width: 9300 },
    );
    const rows = [`<w:tr>${header}</w:tr>`];
    if (content) {
      rows.push(
        `<w:tr>${this.renderLkpdCell(content, { width: 9300 })}</w:tr>`,
      );
    }
    return this.renderLkpdTable(rows.join(''), [9300]);
  }

  private renderLkpdNumberedList(items: string[]): string {
    return items
      .map((item, index) =>
        this.renderLkpdParagraph(`${index + 1}. ${item}`, {
          spacingAfter: 55,
        }),
      )
      .join('');
  }

  private renderLkpdBox(content: string): string {
    return this.renderLkpdTable(
      `<w:tr>${this.renderLkpdCell(content, { width: 9300 })}</w:tr>`,
      [9300],
    );
  }

  private renderLkpdAnswerArea(height: number): string {
    return this.renderLkpdTable(
      `<w:tr><w:trPr><w:trHeight w:val="${height}" w:hRule="atLeast"/></w:trPr>${this.renderLkpdCell(
        this.renderLkpdParagraph('', { spacingAfter: 0 }),
        { height, width: 9300 },
      )}</w:tr>`,
      [9300],
    );
  }

  private renderLkpdQuestionTable(): string {
    const header = `<w:tr>${this.renderLkpdCell(
      this.renderLkpdParagraph('Pertanyaan', {
        bold: true,
        color: '315B7D',
        spacingAfter: 0,
      }),
      { fill: 'D9E6F2', width: 4650 },
    )}${this.renderLkpdCell(
      this.renderLkpdParagraph('Jawaban', {
        bold: true,
        color: '315B7D',
        spacingAfter: 0,
      }),
      { fill: 'D9E6F2', width: 4650 },
    )}</w:tr>`;
    const questions = [
      'Apa informasi utama dari situasi tersebut?',
      'Apa dampak atau hasil yang dapat disimpulkan?',
      'Apa dua cara atau solusi yang dapat dilakukan?',
    ];
    const rows = questions
      .map(
        (question) =>
          `<w:tr><w:trPr><w:trHeight w:val="900" w:hRule="atLeast"/></w:trPr>${this.renderLkpdCell(
            this.renderLkpdParagraph(question, { spacingAfter: 0 }),
            { height: 900, width: 4650 },
          )}${this.renderLkpdCell(
            this.renderLkpdParagraph('', { spacingAfter: 0 }),
            { height: 900, width: 4650 },
          )}</w:tr>`,
      )
      .join('');
    return this.renderLkpdTable(`${header}${rows}`, [4650, 4650]);
  }

  private renderLkpdFirstQuestionSection(question: string): string {
    const header = this.renderLkpdCell(
      this.renderLkpdParagraph('F.  Soal-soal', {
        bold: true,
        color: '254664',
        spacingAfter: 0,
      }),
      { fill: 'EAF5F7', width: 9300 },
    );
    const instruction = this.renderLkpdCell(
      [
        this.renderLkpdParagraph(
          'Kerjakan soal berikut pada tempat yang tersedia.',
          { bold: true, spacingAfter: 100 },
        ),
        this.renderLkpdParagraph(`Soal 1. ${question}`, {
          bold: true,
          spacingAfter: 0,
        }),
      ].join(''),
      { width: 9300 },
    );
    const answer = this.renderLkpdCell(
      this.renderLkpdParagraph('', { spacingAfter: 0 }),
      { height: 2600, width: 9300 },
    );

    return this.renderLkpdTable(
      `<w:tr>${header}</w:tr><w:tr>${instruction}</w:tr><w:tr><w:trPr><w:trHeight w:val="2600" w:hRule="atLeast"/></w:trPr>${answer}</w:tr>`,
      [9300],
    );
  }

  private renderLkpdFooter(title: string): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:color w:val="6B7280"/><w:sz w:val="14"/></w:rPr><w:t xml:space="preserve">${this.escapeXml(
      `LKPD - ${title} | Halaman `,
    )}</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">PAGE</w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  }

  private loadCoverImage(): Buffer | undefined {
    const candidates = [
      resolve(__dirname, 'assets/cover.png'),
      resolve(process.cwd(), 'src/modules/documents/assets/cover.png'),
      resolve(process.cwd(), 'dist/src/modules/documents/assets/cover.png'),
      resolve(process.cwd(), 'dist/modules/documents/assets/cover.png'),
      resolve(process.cwd(), 'assets/documents/cover.png'),
      resolve(process.cwd(), 'cover.png'),
      resolve(process.cwd(), '../cover.png'),
    ];
    const coverPath = candidates.find(
      (candidate) => candidate.endsWith('.png') && existsSync(candidate),
    );

    if (!coverPath) {
      this.logger.warn(
        'cover.png tidak ditemukan. Dokumen dibuat tanpa cover image.',
      );
      return undefined;
    }

    return readFileSync(coverPath);
  }

  private loadPdfCoverImage(): PdfCoverImage | undefined {
    const coverImage = this.loadCoverImage();
    if (!coverImage) {
      return undefined;
    }

    const parsed = this.parsePngForPdf(coverImage);
    if (!parsed) {
      this.logger.warn(
        'cover.png tidak bisa dipakai untuk PDF. Format PNG yang didukung: grayscale/RGB 8-bit non-interlaced.',
      );
      return undefined;
    }

    return parsed;
  }

  private parsePngForPdf(buffer: Buffer): PdfCoverImage | undefined {
    const pngSignature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    if (
      buffer.length < pngSignature.length ||
      !buffer.subarray(0, 8).equals(pngSignature)
    ) {
      return undefined;
    }

    let offset = 8;
    let width = 0;
    let height = 0;
    let bitsPerComponent = 0;
    let colorType = -1;
    let compressionMethod = -1;
    let filterMethod = -1;
    let interlaceMethod = -1;
    const idatParts: Buffer[] = [];

    while (offset + 8 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > buffer.length) {
        return undefined;
      }

      if (type === 'IHDR') {
        width = buffer.readUInt32BE(dataStart);
        height = buffer.readUInt32BE(dataStart + 4);
        bitsPerComponent = buffer[dataStart + 8];
        colorType = buffer[dataStart + 9];
        compressionMethod = buffer[dataStart + 10];
        filterMethod = buffer[dataStart + 11];
        interlaceMethod = buffer[dataStart + 12];
      }

      if (type === 'IDAT') {
        idatParts.push(buffer.subarray(dataStart, dataEnd));
      }

      if (type === 'IEND') {
        break;
      }

      offset = dataEnd + 4;
    }

    if (
      !width ||
      !height ||
      bitsPerComponent !== 8 ||
      compressionMethod !== 0 ||
      filterMethod !== 0 ||
      interlaceMethod !== 0 ||
      idatParts.length === 0
    ) {
      return undefined;
    }

    if (colorType === 0) {
      return {
        width,
        height,
        colorSpace: 'DeviceGray',
        colors: 1,
        bitsPerComponent,
        data: Buffer.concat(idatParts),
      };
    }

    if (colorType === 2) {
      return {
        width,
        height,
        colorSpace: 'DeviceRGB',
        colors: 3,
        bitsPerComponent,
        data: Buffer.concat(idatParts),
      };
    }

    return undefined;
  }

  private renderPdfCoverContent(
    title: string,
    identity: Record<string, string>,
  ): Buffer {
    const coverTitle = this.coverTitle(title, identity);
    const educationLevel = this.usableMetadataValue(identity.educationLevel);
    const gradeLevel = this.usableMetadataValue(identity.gradeLevel);
    const phase = this.usableMetadataValue(identity.phase);
    const subject = this.usableMetadataValue(identity.subject);
    const meetingCount = this.usableMetadataValue(identity.meetingCount);
    const timeAllocation = this.usableMetadataValue(identity.timeAllocation);
    const classLabel = gradeLevel
      ? `${educationLevel || 'Kelas'} ${gradeLevel}`.trim()
      : [educationLevel, phase].filter(Boolean).join(' - ') || subject || 'RPP';
    const meetingLabel =
      meetingCount && timeAllocation
        ? `${meetingCount} Pertemuan x ${timeAllocation}`
        : timeAllocation ||
          (meetingCount ? `${meetingCount} Pertemuan` : 'Pembelajaran');
    const typeLabel =
      this.usableMetadataValue(identity.rppType) || 'Intrakurikuler';
    const titleLines = this.wrapPdfLine(coverTitle, 34).slice(0, 3);
    const commands = ['q 595 0 0 842 0 0 cm /ImCover Do Q'];

    commands.push(
      this.pdfCenteredTextCommand(
        'RPP - Intrakurikuler',
        710,
        16,
        'F2',
        '0.16 0.36 0.20',
      ),
    );

    titleLines.forEach((line, index) => {
      commands.push(
        this.pdfCenteredTextCommand(
          line,
          674 - index * 32,
          28,
          'F2',
          '0.05 0.08 0.10',
        ),
      );
    });

    const subtitle = [phase || subject || educationLevel, classLabel]
      .filter(Boolean)
      .join(' | ');
    if (subtitle) {
      commands.push(
        this.pdfCenteredTextCommand(subtitle, 570, 13, 'F2', '0.10 0.17 0.24'),
      );
    }

    commands.push(
      this.pdfCenteredTextCommand(
        [meetingLabel, typeLabel].filter(Boolean).join(' | '),
        546,
        11,
        'F1',
        '0.20 0.25 0.30',
      ),
    );

    return Buffer.from(commands.join('\n'));
  }

  private pdfCenteredTextCommand(
    text: string,
    y: number,
    size: number,
    font: 'F1' | 'F2',
    color: string,
  ): string {
    const cleaned = this.cleanInlineText(text);
    const estimatedWidth = cleaned.length * size * 0.52;
    const x = Math.max(42, (595 - estimatedWidth) / 2);

    return `BT ${color} rg /${font} ${size} Tf ${x.toFixed(2)} ${y} Td (${this.escapePdf(
      cleaned,
    )}) Tj ET`;
  }

  private renderDocxCover(
    title: string,
    identity: Record<string, string>,
    withImage: boolean,
  ): string {
    const coverTitle = this.coverTitle(title, identity);
    const educationLevel = this.usableMetadataValue(identity.educationLevel);
    const gradeLevel = this.usableMetadataValue(identity.gradeLevel);
    const phase = this.usableMetadataValue(identity.phase);
    const subject = this.usableMetadataValue(identity.subject);
    const meetingCount = this.usableMetadataValue(identity.meetingCount);
    const timeAllocation = this.usableMetadataValue(identity.timeAllocation);
    const classLabel = gradeLevel
      ? `${educationLevel || 'Kelas'} ${gradeLevel}`.trim()
      : [educationLevel, phase].filter(Boolean).join(' - ') || subject || 'RPP';
    const meetingLabel =
      meetingCount && timeAllocation
        ? `${meetingCount} Pertemuan x ${timeAllocation}`
        : timeAllocation ||
          (meetingCount ? `${meetingCount} Pertemuan` : 'Pembelajaran');
    const typeLabel =
      this.usableMetadataValue(identity.rppType) || 'Intrakurikuler';

    return [
      withImage ? this.renderDocxCoverImage() : '',
      this.renderDocxParagraph('RPP - Intrakurikuler', {
        align: 'center',
        bold: true,
        color: TEMPLATE_GREEN,
        fontSize: 36,
        spacingBefore: 2800,
        spacingAfter: 260,
      }),
      this.renderDocxParagraph(coverTitle, {
        align: 'center',
        bold: true,
        color: '000000',
        fontSize: 58,
        spacingAfter: 180,
      }),
      this.renderDocxParagraph(phase || subject || educationLevel || '', {
        align: 'center',
        bold: true,
        color: '000000',
        fontSize: 40,
        spacingAfter: 420,
      }),
      this.renderDocxCoverChips([
        { text: classLabel, fill: '31A94B' },
        { text: meetingLabel, fill: '2876A8' },
        { text: typeLabel, fill: TEMPLATE_ORANGE },
      ]),
      this.renderDocxSectionBreak({
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      }),
    ].join('');
  }

  private renderDocxCoverImage(): string {
    return `<w:p><w:pPr><w:spacing w:after="0"/></w:pPr><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="251658240" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="${DOCX_PAGE_WIDTH_EMU}" cy="${DOCX_PAGE_HEIGHT_EMU}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="1" name="Cover"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="0"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="cover.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rIdCoverImage"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${DOCX_PAGE_WIDTH_EMU}" cy="${DOCX_PAGE_HEIGHT_EMU}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`;
  }

  private renderDocxCoverChips(
    chips: Array<{ text: string; fill: string }>,
  ): string {
    const cells = chips
      .map(
        (chip) =>
          `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/><w:shd w:fill="${chip.fill}"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr>${this.renderDocxParagraph(
            chip.text,
            {
              align: 'center',
              bold: true,
              color: 'FFFFFF',
              fontSize: 20,
              spacingAfter: 0,
            },
          )}</w:tc>`,
      )
      .join('');

    return `<w:tbl><w:tblPr><w:tblW w:w="7600" w:type="dxa"/><w:jc w:val="center"/><w:tblCellSpacing w:w="220" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid><w:tr>${cells}</w:tr></w:tbl>`;
  }

  private renderDocxTableOfContents(blocks: DocumentBlock[]): string {
    const headings = blocks.filter(
      (block): block is { type: 'heading'; level: 1 | 2 | 3; text: string } =>
        block.type === 'heading' && block.level <= 2,
    );

    return [
      this.renderDocxParagraph('Daftar Isi', {
        align: 'center',
        bold: true,
        color: TEMPLATE_BLUE,
        fontSize: 28,
        spacingBefore: 320,
        spacingAfter: 240,
      }),
      ...headings.map((heading) =>
        this.renderDocxParagraph(heading.text, {
          bold: heading.level === 1,
          color: heading.level === 1 ? TEMPLATE_BLUE : TEMPLATE_DARK,
          fontSize: heading.level === 1 ? 22 : 20,
          spacingAfter: 80,
          indentLeft: heading.level === 1 ? 0 : 360,
        }),
      ),
      this.renderDocxPageBreak(),
    ].join('');
  }

  private renderDocxFooter(
    title: string,
    identity: Record<string, string>,
  ): string {
    const footerTitle = this.coverTitle(title, identity);

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr>${this.renderDocxRuns(
      `RPP Intrakurikuler - ${footerTitle} | Halaman `,
      {
        color: '6B7280',
        size: 18,
      },
    )}<w:r><w:rPr><w:rFonts w:ascii="Frutiger" w:hAnsi="Frutiger" w:cs="Frutiger"/><w:color w:val="6B7280"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:rFonts w:ascii="Frutiger" w:hAnsi="Frutiger" w:cs="Frutiger"/><w:color w:val="6B7280"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:instrText xml:space="preserve">PAGE</w:instrText></w:r><w:r><w:rPr><w:rFonts w:ascii="Frutiger" w:hAnsi="Frutiger" w:cs="Frutiger"/><w:color w:val="6B7280"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  }

  private coverTitle(title: string, identity: Record<string, string>): string {
    const fromTopic =
      identity.topic && !this.isEmptyMetadataValue(identity.topic)
        ? identity.topic
        : title;
    const cleaned = fromTopic
      .replace(/[-_]+/g, ' ')
      .replace(/\bintrakurikuler\b/gi, '')
      .replace(/\brpp\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    return cleaned
      .toLowerCase()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  private renderDocxPageBreak(): string {
    return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  }

  private renderDocxSectionBreak(margins: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  }): string {
    return `<w:p><w:pPr><w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="${DOCX_PAGE_WIDTH_TWIPS}" w:h="${DOCX_PAGE_HEIGHT_TWIPS}"/><w:pgMar w:top="${margins.top}" w:right="${margins.right}" w:bottom="${margins.bottom}" w:left="${margins.left}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:pPr></w:p>`;
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
      const line = this.normalizeMarkdownLine(rawLine.trim());

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
            const nextLine = this.normalizeMarkdownLine(
              (lines[nextIndex] ?? '').trim(),
            );
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

      blocks.push({
        type: 'paragraph',
        text: this.cleanInlineText(line, true),
      });
    }

    return blocks.filter(
      (block, index, all) =>
        block.type !== 'spacer' ||
        (index > 0 &&
          index < all.length - 1 &&
          all[index - 1].type !== 'spacer'),
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

  private normalizeMarkdownLine(line: string): string {
    return line
      .replace(/^(>\s*)+/, '')
      .replace(/^\*\*Langkah\s*-\s*\d+\*\*\s*/i, '')
      .replace(/^Langkah\s*-\s*\d+\s*/i, '')
      .trim();
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
      schoolName: this.cleanMetadataValue(
        school?.name ?? contextSchoolName ?? '',
      ),
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
      .filter(
        (row): row is MetadataRow =>
          row !== undefined && !this.isEmptyMetadataValue(row.value),
      );
  }

  private applyMetadataOverride(
    row: MetadataRow,
    identityOverrides: Record<string, string>,
  ): MetadataRow {
    const override = this.usableMetadataValue(identityOverrides[row.key]);
    const authoritativeKeys = new Set([
      'schoolName',
      'teacherName',
      'academicYear',
    ]);

    if (
      override &&
      (authoritativeKeys.has(row.key) || this.isEmptyMetadataValue(row.value))
    ) {
      return {
        ...row,
        value: this.formatMetadataRowValue(row.key, override),
      };
    }

    return {
      ...row,
      value: this.formatMetadataRowValue(row.key, row.value),
    };
  }

  private parseMetadataRow(line: string): MetadataRow | undefined {
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

  private formatMetadataRowValue(key: string, value: string): string {
    const cleaned = this.cleanMetadataValue(value);
    if (this.isEmptyMetadataValue(cleaned)) {
      return '-';
    }

    if (key === 'educationLevel') {
      return this.formatEducationLevel(cleaned);
    }

    if (key === 'phase') {
      return this.formatPhase(cleaned);
    }

    if (key === 'rppType') {
      return this.formatRppType(cleaned);
    }

    return cleaned;
  }

  private isEmptyMetadataValue(value: string): boolean {
    const cleaned = value.trim();
    return (
      !cleaned ||
      /^[-–—]$/.test(cleaned) ||
      /^(none|null|undefined)$/i.test(cleaned)
    );
  }

  private usableMetadataValue(value: string | undefined): string | undefined {
    const cleaned = value?.trim();
    if (!cleaned || this.isEmptyMetadataValue(cleaned)) {
      return undefined;
    }
    return cleaned;
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
      ? cleaned.replace(
          /^fase\s+([a-z])/i,
          (_, letter: string) => `Fase ${letter.toUpperCase()}`,
        )
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
        color: TEMPLATE_BLUE,
        fontSize: 34,
        spacingAfter: 220,
      });
    }

    if (block.type === 'heading') {
      const isMajorSection = /^[A-Z]\.\s+/.test(block.text);
      const isNumberedSection = /^\d+[.)]\s+/.test(block.text);
      const headingOptions = isMajorSection
        ? { fontSize: 28, spacingBefore: 220, spacingAfter: 140 }
        : isNumberedSection
          ? { fontSize: 25, spacingBefore: 180, spacingAfter: 110 }
          : block.level === 1
            ? { fontSize: 28, spacingBefore: 180, spacingAfter: 130 }
            : block.level === 2
              ? { fontSize: 24, spacingBefore: 170, spacingAfter: 110 }
              : { fontSize: 21, spacingBefore: 140, spacingAfter: 90 };
      const headingColor = isMajorSection
        ? '000000'
        : isNumberedSection
          ? TEMPLATE_BLUE
          : block.level === 1
            ? '000000'
            : block.level === 2
              ? TEMPLATE_BLUE
              : TEMPLATE_GOLD;

      return this.renderDocxParagraph(block.text, {
        ...headingOptions,
        bold: true,
        color: headingColor,
      });
    }

    if (block.type === 'table') {
      return this.renderDocxTable(block.rows);
    }

    if (block.type === 'bullet') {
      return this.renderDocxParagraph(block.text, {
        bullet: true,
        color: TEMPLATE_DARK,
        fontSize: 21,
        spacingAfter: 70,
      });
    }

    if (block.type === 'checklist') {
      return this.renderDocxParagraph(
        `${block.checked ? '☑' : '☐'} ${block.text}`,
        {
          color: TEMPLATE_DARK,
          fontSize: 21,
          spacingAfter: 70,
        },
      );
    }

    if (block.type === 'spacer') {
      return this.renderDocxParagraph('', { spacingAfter: 80 });
    }

    return this.renderDocxParagraph(block.text, {
      color: TEMPLATE_DARK,
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
      align?: 'left' | 'center' | 'both';
      justify?: boolean;
      indentLeft?: number;
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
      options.align
        ? `<w:jc w:val="${options.align}"/>`
        : options.justify
          ? '<w:jc w:val="both"/>'
          : '',
      options.bullet
        ? '<w:ind w:left="360" w:hanging="180"/>'
        : options.indentLeft
          ? `<w:ind w:left="${options.indentLeft}"/>`
          : '',
      options.bottomBorder
        ? `<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${TEMPLATE_TABLE_BORDER}"/></w:pBdr>`
        : '',
    ].join('');
    const bulletPrefix = options.bullet ? '• ' : '';

    return `<w:p><w:pPr>${paragraphProperties}</w:pPr>${this.renderDocxRuns(
      `${bulletPrefix}${text}`,
      {
        bold: options.bold,
        color: options.color ?? TEMPLATE_DARK,
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
          '<w:rFonts w:ascii="Frutiger" w:hAnsi="Frutiger" w:cs="Frutiger"/>',
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

  private parseInlineSegments(
    text: string,
  ): Array<{ text: string; bold: boolean }> {
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
            fill: TEMPLATE_TABLE_FILL,
            width: 3000,
          })}${this.renderDocxTableCell(row.value, {
            width: 5900,
          })}</w:tr>`,
      )
      .join('');

    return `<w:tbl><w:tblPr><w:tblW w:w="8900" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="${TEMPLATE_TABLE_BORDER}"/><w:left w:val="single" w:sz="4" w:color="${TEMPLATE_TABLE_BORDER}"/><w:bottom w:val="single" w:sz="4" w:color="${TEMPLATE_TABLE_BORDER}"/><w:right w:val="single" w:sz="4" w:color="${TEMPLATE_TABLE_BORDER}"/><w:insideH w:val="single" w:sz="4" w:color="${TEMPLATE_TABLE_BORDER}"/><w:insideV w:val="single" w:sz="4" w:color="${TEMPLATE_TABLE_BORDER}"/></w:tblBorders><w:tblCellMar><w:top w:w="120" w:type="dxa"/><w:left w:w="160" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:right w:w="160" w:type="dxa"/></w:tblCellMar></w:tblPr>${tableRows}</w:tbl>`;
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
        color: options.bold ? TEMPLATE_DARK_BLUE : TEMPLATE_DARK,
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

  private pdfObject(id: number, body: string): Buffer {
    return Buffer.from(`${id} 0 obj ${body} endobj\n`);
  }

  private pdfStreamObject(
    id: number,
    dictionary: string,
    stream: Buffer,
  ): Buffer {
    return Buffer.concat([
      Buffer.from(`${id} 0 obj ${dictionary} stream\n`),
      stream,
      Buffer.from('\nendstream endobj\n'),
    ]);
  }

  private buildPdfBuffer(objects: Buffer[]): Buffer {
    const header = Buffer.from('%PDF-1.4\n');
    const parts: Buffer[] = [header];
    const offsets: number[] = [];
    let offset = header.length;

    for (const object of objects) {
      offsets.push(offset);
      parts.push(object);
      offset += object.length;
    }

    const xrefOffset = offset;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const objectOffset of offsets) {
      xref += `${String(objectOffset).padStart(10, '0')} 00000 n \n`;
    }
    xref += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.concat([...parts, Buffer.from(xref)]);
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

  private zipStore(files: DocxZipFile[]): Buffer {
    const localParts: Buffer[] = [];
    const centralParts: Buffer[] = [];
    let offset = 0;

    for (const file of files) {
      const name = Buffer.from(file.name);
      const data = Buffer.isBuffer(file.content)
        ? file.content
        : Buffer.from(file.content);
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
