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

type IntraFinalTableRow = { label: string; value: string };

type IntraFinalMeeting = {
  order: number;
  title: string;
  intro: string;
  focus: string;
  target: string;
  diagnostic: {
    step1: string;
    sampleQuestion: string;
    answerOptions: string[];
    correctAnswer: string;
    step2: string;
    teacherNotes: string;
  };
  understanding: {
    teacherNotes: string;
    step4: string;
    step5: string;
    triggerQuestions: string[];
  };
  applying: {
    step6: string;
    supportGroup: string;
    advancedGroup: string;
    step7: string;
    flowSummary: string[];
    product: string;
  };
  reflecting: {
    description: string;
    step8: string;
    questions: string[];
  };
  formative: {
    step9: string;
    technique: string;
    indicators: string[];
    recordFormat: string;
  };
};

type IntraFinalDocumentData = {
  title: string;
  footerTitle: string;
  identityRows: IntraFinalTableRow[];
  materialContext: string;
  graduateProfiles: IntraFinalTableRow[];
  interdisciplinaryRows: IntraFinalTableRow[];
  learningObjectives: string[];
  essentialQuestion: string;
  pedagogicalDescription: string;
  pedagogicalForms: IntraFinalTableRow[];
  partnershipRows: IntraFinalTableRow[];
  digitalRows: IntraFinalTableRow[];
  digitalNotes: string;
  resourceRows: IntraFinalTableRow[];
  meetingOverview: string;
  meetings: IntraFinalMeeting[];
  summative: {
    provision: string;
    description: string;
    sampleTasks: string[];
    criteria: string[];
    achievementLevels: IntraFinalTableRow[];
  };
  followUp: {
    description: string;
    rows: IntraFinalTableRow[];
    enrichmentExample: string;
  };
  teacherReflection: {
    description: string;
    questions: string[];
  };
  finalFlowSummary: string;
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
      throw new NotFoundException('RPM yang dihasilkan tidak ditemukan.');
    }

    if (
      documentKind === 'lkpd' &&
      generated.rppProject.rppType !== 'intrakurikuler'
    ) {
      throw new BadRequestException(
        'Dokumen LKPD saat ini hanya tersedia untuk RPM intrakurikuler.',
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
    const isIntrakurikulerRpp =
      documentKind === 'rpp' &&
      generated.rppProject.rppType === 'intrakurikuler';
    const buffer =
      documentKind === 'lkpd' && lkpdData
        ? fileType === ExportFileType.pdf
          ? await this.renderLkpdPdf(lkpdData)
          : this.renderLkpdDocx(lkpdData)
        : isIntrakurikulerRpp
          ? fileType === ExportFileType.pdf
            ? await this.renderIntraFinalPdf(
                title,
                generated.contentJson,
                identityOverrides,
              )
            : await this.renderIntraFinalDocxWithUpdatedToc(
                title,
                generated.contentJson,
                identityOverrides,
              )
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

  private renderIntraFinalDocx(
    title: string,
    contentJson: unknown,
    identityOverrides: Record<string, string>,
  ): Buffer {
    const data = this.buildIntraFinalDocumentData(
      title,
      contentJson,
      identityOverrides,
    );
    const coverImage = this.loadCoverImage();
    const questionIconImage = this.loadQuestionIconImage();
    const warningIconImage = this.loadWarningIconImage();
    const bookIconImage = this.loadBookIconImage();
    const documentRelationships = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${coverImage ? '<Relationship Id="rIdCoverImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/cover.png"/>' : ''}${questionIconImage ? '<Relationship Id="rIdQuestionIcon" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/questionicon.png"/>' : ''}${warningIconImage ? '<Relationship Id="rIdWarningIcon" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/warningicon.png"/>' : ''}${bookIconImage ? '<Relationship Id="rIdBookIcon" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/bookicon.png"/>' : ''}<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/><Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/></Relationships>`;
    const body = [
      this.renderDocxCover(title, identityOverrides, Boolean(coverImage)),
      this.renderIntraFinalTableOfContents(),
      this.renderIntraFinalBody(data, {
        question: Boolean(questionIconImage),
        warning: Boolean(warningIconImage),
        book: Boolean(bookIconImage),
      }),
    ].join('');
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>
${body}
<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter1"/><w:pgSz w:w="${DOCX_PAGE_WIDTH_TWIPS}" w:h="${DOCX_PAGE_HEIGHT_TWIPS}"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1080" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>
</w:body></w:document>`;

    const files: DocxZipFile[] = [
      {
        name: '[Content_Types].xml',
        content: `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${coverImage || questionIconImage || warningIconImage || bookIconImage ? '<Default Extension="png" ContentType="image/png"/>' : ''}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/></Types>`,
      },
      {
        name: '_rels/.rels',
        content:
          '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      },
      ...(coverImage
        ? [
            {
              name: 'word/media/cover.png',
              content: coverImage,
            },
          ]
        : []),
      ...(questionIconImage
        ? [
            {
              name: 'word/media/questionicon.png',
              content: questionIconImage,
            },
          ]
        : []),
      ...(warningIconImage
        ? [
            {
              name: 'word/media/warningicon.png',
              content: warningIconImage,
            },
          ]
        : []),
      ...(bookIconImage
        ? [
            {
              name: 'word/media/bookicon.png',
              content: bookIconImage,
            },
          ]
        : []),
      {
        name: 'word/_rels/document.xml.rels',
        content: documentRelationships,
      },
      {
        name: 'word/footer1.xml',
        content: this.renderIntraFinalFooter(data.footerTitle),
      },
      {
        name: 'word/settings.xml',
        content: this.renderDocxUpdateFieldsSettings(),
      },
      {
        name: 'word/document.xml',
        content: documentXml,
      },
    ];
    return this.zipStore(files);
  }

  private async renderIntraFinalPdf(
    title: string,
    contentJson: unknown,
    identityOverrides: Record<string, string>,
  ): Promise<Buffer> {
    const directory = await fs.mkdtemp(join(tmpdir(), 'petunjukku-intra-'));
    const docxPath = join(directory, 'intra-final.docx');
    const pdfPath = join(directory, 'intra-final.pdf');
    const scriptPath = join(directory, 'update-toc-export.py');

    try {
      await fs.writeFile(
        docxPath,
        this.renderIntraFinalDocx(title, contentJson, identityOverrides),
      );
      await fs.writeFile(scriptPath, this.renderLibreOfficeTocExportScript());
      await execFileAsync(
        'python3',
        [
          scriptPath,
          docxPath,
          pdfPath,
          String(20000 + Math.floor(Math.random() * 20000)),
          'pdf',
        ],
        { timeout: 120000 },
      );
      return await fs.readFile(pdfPath);
    } catch (error) {
      this.logger.error(
        `Gagal merender PDF RPM intrakurikuler: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new Error(
        'PDF RPM intrakurikuler belum bisa dibuat. Pastikan LibreOffice tersedia.',
      );
    } finally {
      await fs.rm(directory, { force: true, recursive: true });
    }
  }

  private async renderIntraFinalDocxWithUpdatedToc(
    title: string,
    contentJson: unknown,
    identityOverrides: Record<string, string>,
  ): Promise<Buffer> {
    const directory = await fs.mkdtemp(join(tmpdir(), 'petunjukku-intra-'));
    const docxPath = join(directory, 'intra-final.docx');
    const scriptPath = join(directory, 'update-toc-export.py');

    try {
      await fs.writeFile(
        docxPath,
        this.renderIntraFinalDocx(title, contentJson, identityOverrides),
      );
      await fs.writeFile(scriptPath, this.renderLibreOfficeTocExportScript());
      await execFileAsync(
        'python3',
        [
          scriptPath,
          docxPath,
          docxPath,
          String(20000 + Math.floor(Math.random() * 20000)),
          'docx',
        ],
        { timeout: 120000 },
      );
      return await fs.readFile(docxPath);
    } catch (error) {
      this.logger.warn(
        `Gagal memperbarui daftar isi DOCX RPM intrakurikuler: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.renderIntraFinalDocx(title, contentJson, identityOverrides);
    } finally {
      await fs.rm(directory, { force: true, recursive: true });
    }
  }

  private renderLibreOfficeTocExportScript(): string {
    return String.raw`import os
import shutil
import subprocess
import sys
import tempfile
import time
import uno
from com.sun.star.beans import PropertyValue


def prop(name, value):
    item = PropertyValue()
    item.Name = name
    item.Value = value
    return item


def connect(port):
    local_ctx = uno.getComponentContext()
    resolver = local_ctx.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver",
        local_ctx,
    )
    return resolver.resolve(
        f"uno:socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext"
    )


docx_path = os.path.abspath(sys.argv[1])
output_path = os.path.abspath(sys.argv[2])
port = int(sys.argv[3])
output_kind = sys.argv[4] if len(sys.argv) > 4 else "pdf"
profile_dir = tempfile.mkdtemp(prefix="lo-profile-")
proc = subprocess.Popen(
    [
        "libreoffice",
        "--headless",
        "--invisible",
        "--nodefault",
        "--nofirststartwizard",
        "--nologo",
        f"-env:UserInstallation={uno.systemPathToFileUrl(profile_dir)}",
        f"--accept=socket,host=127.0.0.1,port={port};urp;StarOffice.ComponentContext",
    ],
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
)

try:
    ctx = None
    last_error = None
    for _ in range(60):
        try:
            ctx = connect(port)
            break
        except Exception as exc:
            last_error = exc
            time.sleep(0.25)

    if ctx is None:
        raise RuntimeError(f"LibreOffice UNO tidak siap: {last_error}")

    desktop = ctx.ServiceManager.createInstanceWithContext(
        "com.sun.star.frame.Desktop",
        ctx,
    )
    doc = desktop.loadComponentFromURL(
        uno.systemPathToFileUrl(docx_path),
        "_blank",
        0,
        tuple(
            [
                prop("Hidden", True),
                prop("ReadOnly", False),
                prop("UpdateDocMode", 3),
            ]
        ),
    )

    if doc is None:
        raise RuntimeError("Dokumen tidak bisa dibuka oleh LibreOffice")

    indexes = doc.getDocumentIndexes()
    for index in range(indexes.getCount()):
        indexes.getByIndex(index).update()

    try:
        doc.TextFields.refresh()
    except Exception:
        pass

    if output_kind == "docx":
        doc.store()
    else:
        doc.storeToURL(
            uno.systemPathToFileUrl(output_path),
            tuple(
                [
                    prop("FilterName", "writer_pdf_Export"),
                    prop("Overwrite", True),
                ]
            ),
        )
    doc.close(True)
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
    shutil.rmtree(profile_dir, ignore_errors=True)
`;
  }

  private buildIntraFinalDocumentData(
    title: string,
    contentJson: unknown,
    identityOverrides: Record<string, string>,
  ): IntraFinalDocumentData {
    const content = this.recordValue(contentJson);
    const identity = this.recordValue(content.identity);
    const profile = this.recordValue(content.profileAndLearningDirection);
    const interdisciplinary = this.recordValue(
      profile.interdisciplinaryIntegration,
    );
    const learningDesign = this.recordValue(content.learningDesign);
    const pedagogical = this.recordValue(learningDesign.pedagogicalPractice);
    const partnership = this.recordValue(learningDesign.partnership);
    const digitalUse = this.recordValue(learningDesign.digitalUse);
    const meetingActivities = this.recordValue(content.meetingActivities);
    const assessment = this.recordValue(content.assessment);
    const summative = this.recordValue(assessment.summative);
    const followUp = this.recordValue(content.followUp);
    const teacherReflection = this.recordValue(content.teacherReflection);
    const field = (key: string, fallback = '') =>
      this.firstIntraText(identityOverrides[key], identity[key], fallback);
    const topic = field('topic', this.firstIntraText(content.title, title));
    const subject = field('subject');
    const meetingCount = this.formatIntraMeetingCount(field('meetingCount'));
    const timeAllocation = field('timeAllocation');
    const footerTitle = this.coverTitle(title, {
      ...identityOverrides,
      topic,
      subject,
    });
    const interdisciplinaryDiscipline =
      this.firstIntraText(interdisciplinary.relatedDiscipline) ||
      this.firstIntraText(interdisciplinary.relatedSubject) ||
      this.firstIntraText(interdisciplinary.subject) ||
      'Tidak ada lintas disiplin khusus';
    const interdisciplinaryRationale =
      this.firstIntraText(interdisciplinary.rationale) ||
      `Pembelajaran tetap berpusat pada ${subject || 'mata pelajaran utama'} dan dapat dikaitkan dengan konteks lain yang relevan bila tersedia.`;
    const interdisciplinaryForm =
      this.firstIntraText(interdisciplinary.integrationForm) ||
      `Integrasi dilakukan sebagai penguat konteks saat murid memahami ${topic || 'materi'} dan mengaitkannya dengan pengalaman belajar sehari-hari.`;
    const interdisciplinaryNotes =
      this.firstIntraText(interdisciplinary.notes) ||
      'Lintas disiplin bersifat pendukung. Kompetensi utama tetap mengikuti tujuan pembelajaran mata pelajaran inti.';

    return {
      title: this.firstIntraText(content.title, title) || title,
      footerTitle,
      identityRows: [
        ['Nama Sekolah', field('schoolName')],
        ['Nama Guru', field('teacherName')],
        ['Jenjang', field('educationLevel')],
        ['Fase', field('phase')],
        ['Kelas/Semester', field('gradeLevel')],
        ['Mata Pelajaran', subject],
        ['Materi/Pokok Bahasan', topic],
        ['Elemen', field('element')],
        ['Alokasi Waktu Total', timeAllocation],
        ['Jumlah Pertemuan', meetingCount],
        ['Tahun Ajaran', field('academicYear')],
      ].map(([label, value]) => ({ label, value: value || '-' })),
      materialContext:
        this.firstIntraText(content.materialContext) ||
        `RPP ini mengaitkan materi ${topic || 'pembelajaran'} dengan situasi sehari-hari yang dekat dengan murid. Fokus utamanya tetap pada ${subject || 'mata pelajaran'} dan penggunaan konsep untuk menyelesaikan masalah secara runtut.`,
      graduateProfiles: this.recordList(profile.graduateProfiles)
        .map((item) => ({
          label: this.firstIntraText(item.dimension, item.name),
          value: this.firstIntraText(item.description),
        }))
        .filter((row) => row.label || row.value),
      interdisciplinaryRows: [
        {
          label: 'Disiplin Ilmu Terkait',
          value: interdisciplinaryDiscipline,
        },
        {
          label: 'Alasan Keterkaitan',
          value: interdisciplinaryRationale,
        },
        {
          label: 'Bentuk Integrasi',
          value: interdisciplinaryForm,
        },
        {
          label: 'Catatan',
          value: interdisciplinaryNotes,
        },
      ],
      learningObjectives: this.intraStringList(profile.learningObjectives),
      essentialQuestion: this.firstIntraText(profile.essentialQuestion),
      pedagogicalDescription: this.firstIntraText(pedagogical.description),
      pedagogicalForms: this.recordList(pedagogical.forms)
        .map((item) => ({
          label: this.firstIntraText(item.name, item.title),
          value: this.firstIntraText(item.description, item.function),
        }))
        .filter((row) => row.label || row.value),
      partnershipRows: this.recordList(partnership.items)
        .map((item) => ({
          label: this.firstIntraText(item.partner, item.name),
          value: this.firstIntraText(item.partnerRole, item.role, item.notes),
        }))
        .filter((row) => row.label || row.value),
      digitalRows: this.recordList(digitalUse.items)
        .map((item) => ({
          label: this.firstIntraText(item.sourceOrPlatform, item.source),
          value: [
            this.firstIntraText(item.linkOrAccess, item.access),
            this.firstIntraText(item.function),
          ]
            .filter(Boolean)
            .join('\n'),
        }))
        .filter((row) => row.label || row.value),
      digitalNotes: this.firstIntraText(digitalUse.notes),
      resourceRows: this.recordList(learningDesign.resources)
        .map((item) => ({
          label: this.firstIntraText(item.name, item.title),
          value: this.firstIntraText(item.function, item.description),
        }))
        .filter((row) => row.label || row.value),
      meetingOverview: this.firstIntraText(meetingActivities.overview),
      meetings: this.recordList(meetingActivities.meetings).map(
        (meeting, index) => this.buildIntraFinalMeeting(meeting, index),
      ),
      summative: {
        provision: this.firstIntraText(summative.provision),
        description: this.firstIntraText(summative.description),
        sampleTasks: this.intraStringList(summative.sampleTasks),
        criteria: this.intraStringList(summative.criteria),
        achievementLevels: this.recordList(summative.achievementLevels)
          .map((item) => ({
            label: this.firstIntraText(item.level),
            value: [
              this.firstIntraText(item.description),
              this.firstIntraText(item.followUp)
                ? `Tindak lanjut: ${this.firstIntraText(item.followUp)}`
                : '',
            ]
              .filter(Boolean)
              .join(' '),
          }))
          .filter((row) => row.label || row.value),
      },
      followUp: {
        description: this.firstIntraText(followUp.description),
        rows: [
          {
            label: 'Belum mencapai tujuan pembelajaran',
            value: this.firstIntraText(followUp.notYetAchieved),
          },
          {
            label: 'Hampir mencapai tujuan pembelajaran',
            value: this.firstIntraText(followUp.almostAchieved),
          },
          {
            label: 'Sudah mencapai tujuan pembelajaran',
            value: this.firstIntraText(followUp.achieved),
          },
          {
            label: 'Melampaui tujuan pembelajaran',
            value: this.firstIntraText(followUp.exceeding),
          },
        ].filter((row) => row.value),
        enrichmentExample: this.firstIntraText(followUp.enrichmentExample),
      },
      teacherReflection: {
        description: this.firstIntraText(teacherReflection.description),
        questions: this.intraStringList(teacherReflection.questions),
      },
      finalFlowSummary: this.firstIntraText(content.finalFlowSummary),
    };
  }

  private buildIntraFinalMeeting(
    meeting: Record<string, unknown>,
    index: number,
  ): IntraFinalMeeting {
    const diagnostic = this.recordValue(meeting.diagnostic);
    const understanding = this.recordValue(meeting.understanding);
    const applying = this.recordValue(meeting.applying);
    const differentiation = this.recordValue(applying.differentiation);
    const reflecting = this.recordValue(meeting.reflecting);
    const formative = this.recordValue(meeting.formativeAssessment);
    const orderText = this.firstIntraText(meeting.meetingOrder);
    const order = Number.parseInt(orderText, 10) || index + 1;
    const focus = this.firstIntraText(meeting.focus);

    return {
      order,
      title:
        this.normalizeIntraMeetingTitle(
          this.firstIntraText(meeting.meetingTitle, meeting.title, focus),
          order,
        ) ||
        focus ||
        `Pertemuan ${order}`,
      intro: this.firstIntraText(meeting.introParagraph, meeting.description),
      focus,
      target: this.firstIntraText(meeting.target),
      diagnostic: {
        step1: this.firstIntraText(
          diagnostic.step1Description,
          diagnostic.description,
        ),
        sampleQuestion: this.firstIntraText(diagnostic.sampleQuestion),
        answerOptions: this.intraStringList(diagnostic.answerOptions),
        correctAnswer: this.firstIntraText(diagnostic.correctAnswer),
        step2: this.firstIntraText(diagnostic.step2Description),
        teacherNotes: this.firstIntraText(diagnostic.teacherNotes),
      },
      understanding: {
        teacherNotes: this.firstIntraText(understanding.teacherNotes),
        step4: this.firstIntraText(
          understanding.step4Description,
          understanding.description,
        ),
        step5: this.firstIntraText(understanding.step5Description),
        triggerQuestions: this.intraStringList(understanding.triggerQuestions),
      },
      applying: {
        step6: this.firstIntraText(
          applying.step6Description,
          applying.description,
        ),
        supportGroup: this.firstIntraText(differentiation.supportGroup),
        advancedGroup: this.firstIntraText(differentiation.advancedGroup),
        step7: this.firstIntraText(applying.step7Description),
        flowSummary: this.intraStringList(applying.flowSummary),
        product: this.firstIntraText(applying.product),
      },
      reflecting: {
        description: this.firstIntraText(reflecting.description),
        step8: this.firstIntraText(reflecting.step8Description),
        questions: this.intraStringList(reflecting.reflectionQuestions),
      },
      formative: {
        step9: this.firstIntraText(
          formative.step9Description,
          formative.description,
        ),
        technique: this.firstIntraText(formative.technique),
        indicators: this.intraStringList(formative.observedIndicators),
        recordFormat: this.firstIntraText(formative.teacherRecordFormat),
      },
    };
  }

  private renderIntraFinalTableOfContents(): string {
    return [
      this.renderIntraParagraph('Daftar Isi', {
        align: 'center',
        bold: true,
        color: TEMPLATE_BLUE,
        size: 28,
        spacingBefore: 760,
        spacingAfter: 720,
      }),
      this.renderDocxAutomaticTableOfContents(),
      this.renderDocxPageBreak(),
    ].join('');
  }

  private buildIntraFinalTocEntries(data: IntraFinalDocumentData): Array<{
    level: 1 | 2;
    page: number;
    text: string;
  }> {
    const firstMeetingPage = 7;
    const pagesPerMeeting = 5;
    const entries: Array<{ level: 1 | 2; page: number; text: string }> = [
      { level: 1, text: 'A. Identitas Pembelajaran', page: 3 },
      { level: 1, text: 'B. Profil dan Arah Pembelajaran', page: 4 },
      { level: 2, text: '1. Profil Lulusan yang Dikembangkan', page: 4 },
      { level: 2, text: '2. Lintas Disiplin Ilmu', page: 4 },
      { level: 2, text: '3. Tujuan Pembelajaran', page: 4 },
      { level: 1, text: 'C. Desain Pembelajaran', page: 5 },
      { level: 2, text: '1. Praktik Pedagogis', page: 5 },
      { level: 2, text: '2. Kemitraan Pembelajaran', page: 5 },
      { level: 2, text: '3. Pemanfaatan Digital', page: 5 },
      { level: 2, text: '4. Sumber Daya', page: 6 },
      {
        level: 1,
        text: 'D. Rangkaian Kegiatan Pembelajaran per Pertemuan',
        page: firstMeetingPage,
      },
    ];

    data.meetings.forEach((meeting, index) => {
      const meetingPage = firstMeetingPage + index * pagesPerMeeting;
      entries.push(
        {
          level: 2,
          text: `Pertemuan ${meeting.order} - ${meeting.title}`,
          page: meetingPage,
        },
        {
          level: 2,
          text: '1. Analisis Diagnostik / Cek Kesiapan Awal',
          page: meetingPage + 1,
        },
        { level: 2, text: '2. Memahami', page: meetingPage + 2 },
        {
          level: 2,
          text: '3. Mengaplikasi - Mini-PjBL Berdiferensiasi',
          page: meetingPage + 3,
        },
        { level: 2, text: '4. Merefleksi', page: meetingPage + 4 },
        { level: 2, text: '5. Asesmen Formatif', page: meetingPage + 4 },
      );
    });

    const summativePage =
      firstMeetingPage + Math.max(data.meetings.length, 1) * pagesPerMeeting;
    entries.push(
      {
        level: 2,
        text: '6. Asesmen Sumatif UH/UTS/UAS',
        page: summativePage,
      },
      {
        level: 1,
        text: 'E. Tindak Lanjut Pembelajaran',
        page: summativePage + 2,
      },
      { level: 1, text: 'F. Refleksi Guru', page: summativePage + 3 },
    );
    return entries;
  }

  private renderIntraFinalBody(
    data: IntraFinalDocumentData,
    assets: { book: boolean; question: boolean; warning: boolean },
  ): string {
    return [
      this.renderIntraHeading('A. Identitas Pembelajaran', 1),
      this.renderIntraKeyValueTable(data.identityRows),
      this.renderIntraSpacer(420),
      this.renderIntraBox(
        'Konteks Materi',
        this.renderIntraParagraph(data.materialContext, {
          justify: true,
          spacingAfter: 0,
        }),
      ),
      this.renderDocxPageBreak(),
      this.renderIntraHeading('B. Profil dan Arah Pembelajaran', 1, {
        spacingBefore: 520,
      }),
      this.renderIntraHeading('1. Profil Lulusan yang Dikembangkan', 2),
      this.renderIntraKeyValueTable(data.graduateProfiles, {
        labelWidth: 2800,
        valueWidth: 6200,
      }),
      this.renderIntraHeading('2. Lintas Disiplin Ilmu', 2, {
        spacingBefore: 360,
      }),
      this.renderIntraKeyValueTable(data.interdisciplinaryRows, {
        labelWidth: 2800,
        valueWidth: 6200,
      }),
      this.renderIntraHeading('3. Tujuan Pembelajaran', 2, {
        spacingBefore: 360,
      }),
      this.renderIntraLearningObjectivesBox(data.learningObjectives),
      this.renderDocxPageBreak(),
      this.renderIntraHeading('C. Desain Pembelajaran', 1, {
        spacingBefore: 420,
      }),
      this.renderIntraHeading('1. Praktik Pedagogis', 2),
      this.renderIntraPedagogicalPracticeBox(
        data.pedagogicalDescription,
        data.pedagogicalForms,
      ),
      this.renderIntraHeading('2. Kemitraan Pembelajaran', 2, {
        spacingBefore: 320,
      }),
      this.renderIntraKeyValueTable(data.partnershipRows, {
        header: ['Mitra', 'Peran Mitra'],
        labelWidth: 2800,
        valueWidth: 6200,
      }),
      this.renderIntraHeading('3. Pemanfaatan Digital', 2, {
        spacingBefore: 320,
      }),
      this.renderIntraKeyValueTable(data.digitalRows, {
        header: ['Sumber Digital', 'Tautan'],
        labelWidth: 3000,
        valueWidth: 6000,
      }),
      data.digitalNotes
        ? this.renderIntraParagraph(data.digitalNotes, {
            justify: true,
            spacingBefore: 120,
          })
        : '',
      this.renderIntraHeading('4. Sumber Daya', 2, {
        spacingBefore: 320,
      }),
      this.renderIntraKeyValueTable(data.resourceRows, {
        header: ['Sumber Daya', 'Fungsi'],
        labelWidth: 3000,
        valueWidth: 6000,
      }),
      this.renderDocxPageBreak(),
      this.renderIntraHeading(
        'D. Rangkaian Kegiatan Pembelajaran per Pertemuan',
        1,
      ),
      this.renderIntraParagraph(data.meetingOverview, {
        justify: true,
        spacingAfter: 260,
      }),
      ...data.meetings.map((meeting, index) =>
        this.renderIntraMeeting(meeting, index, assets),
      ),
      this.renderIntraSummative(data, assets),
      this.renderDocxPageBreak(),
      this.renderIntraHeading('E. Tindak Lanjut Pembelajaran', 1),
      this.renderIntraParagraph(data.followUp.description, {
        justify: true,
      }),
      this.renderIntraKeyValueTable(data.followUp.rows, {
        labelWidth: 3100,
        valueWidth: 5900,
      }),
      data.followUp.enrichmentExample
        ? this.renderIntraEnrichmentExampleBox(data.followUp.enrichmentExample)
        : '',
      this.renderDocxPageBreak(),
      this.renderIntraHeading('F. Refleksi Guru', 1, {
        spacingBefore: 380,
      }),
      this.renderIntraParagraph(data.teacherReflection.description, {
        justify: true,
      }),
      this.renderIntraReflectionTable(data.teacherReflection.questions),
      this.renderIntraFinalFlowSummaryBox(data.finalFlowSummary),
    ].join('');
  }

  private renderIntraMeeting(
    meeting: IntraFinalMeeting,
    index: number,
    assets: { question: boolean; warning: boolean },
  ): string {
    return [
      index > 0 ? this.renderIntraSpacer(260) : '',
      this.renderIntraMeetingHeader(meeting),
      this.renderIntraParagraph(meeting.intro, {
        justify: true,
        spacingBefore: 220,
      }),
      this.renderIntraKeyValueTable(
        [
          { label: 'Fokus Pertemuan', value: meeting.focus },
          { label: 'Target Pertemuan', value: meeting.target },
        ],
        {
          header: ['Fokus Pertemuan', 'Target Pertemuan'],
          labelWidth: 4500,
          valueWidth: 4500,
          useRowsAsSingleHeaderBody: true,
        },
      ),
      this.renderIntraHeading('1. Analisis Diagnostik / Cek Kesiapan Awal', 2),
      this.renderIntraStepParagraph(1, meeting.diagnostic.step1, {
        justify: true,
      }),
      meeting.diagnostic.sampleQuestion
        ? this.renderIntraDiagnosticQuestionBox(
            meeting.diagnostic.sampleQuestion,
            meeting.diagnostic.answerOptions,
            meeting.diagnostic.correctAnswer,
            assets.question,
          )
        : '',
      this.renderIntraStepParagraph(2, meeting.diagnostic.step2, {
        justify: true,
        spacingBefore: 140,
      }),
      meeting.diagnostic.teacherNotes
        ? this.renderIntraTeacherNoteBox(
            meeting.diagnostic.teacherNotes,
            assets.warning,
          )
        : '',
      this.renderIntraHeading('2. Memahami', 2),
      meeting.understanding.teacherNotes
        ? this.renderIntraTeacherNoteBox(
            meeting.understanding.teacherNotes,
            assets.warning,
          )
        : '',
      this.renderIntraStepParagraph(4, meeting.understanding.step4, {
        justify: true,
      }),
      this.renderIntraStepParagraph(5, meeting.understanding.step5, {
        justify: true,
      }),
      meeting.understanding.triggerQuestions.length
        ? this.renderIntraQuestionListBox(
            'Pertanyaan Pemantik',
            meeting.understanding.triggerQuestions,
            assets.question,
          )
        : '',
      this.renderIntraHeading('3. Mengaplikasi - Mini-PjBL Berdiferensiasi', 2),
      this.renderIntraStepParagraph(6, meeting.applying.step6, {
        justify: true,
      }),
      meeting.applying.supportGroup || meeting.applying.advancedGroup
        ? this.renderIntraDifferentiationTable(meeting)
        : '',
      this.renderIntraStepParagraph(7, meeting.applying.step7, {
        justify: true,
        spacingBefore: 160,
      }),
      meeting.applying.flowSummary.length
        ? this.renderIntraApplyingSummaryBox(meeting.applying.flowSummary)
        : '',
      meeting.applying.product
        ? this.renderIntraApplyingProductBox(meeting.applying.product)
        : '',
      this.renderIntraHeading('4. Merefleksi', 2),
      this.renderIntraParagraph(meeting.reflecting.description, {
        justify: true,
      }),
      this.renderIntraStepParagraph(8, meeting.reflecting.step8, {
        justify: true,
      }),
      meeting.reflecting.questions.length
        ? this.renderIntraQuestionListBox(
            'Pertanyaan Refleksi',
            meeting.reflecting.questions,
            assets.question,
          )
        : '',
      this.renderIntraHeading('5. Asesmen Formatif', 2, {
        spacingBefore: 360,
      }),
      this.renderIntraStepParagraph(9, meeting.formative.step9, {
        justify: true,
      }),
      meeting.formative.technique
        ? this.renderIntraParagraph(
            `Teknik Asesmen: ${meeting.formative.technique}`,
            { bold: true },
          )
        : '',
      meeting.formative.indicators.length
        ? this.renderIntraFormativeIndicatorsBox(meeting.formative.indicators)
        : '',
      meeting.formative.recordFormat
        ? this.renderIntraFormativeRecordBox(meeting.formative.recordFormat)
        : '',
    ].join('');
  }

  private renderIntraSummative(
    data: IntraFinalDocumentData,
    assets: { book: boolean },
  ): string {
    const summative = data.summative;
    return [
      this.renderIntraHeading('6. Asesmen Sumatif UH/UTS/UAS', 2),
      summative.provision
        ? this.renderIntraSummativeProvisionBox(
            summative.provision,
            assets.book,
          )
        : '',
      this.renderIntraParagraph(summative.description, {
        justify: true,
      }),
      summative.sampleTasks.length
        ? [
            this.renderIntraParagraph('Contoh Bentuk Soal Sumatif', {
              bold: true,
              spacingBefore: 140,
              spacingAfter: 120,
            }),
            this.renderIntraBulletList(summative.sampleTasks),
          ].join('')
        : '',
      summative.criteria.length
        ? [
            this.renderIntraParagraph('Kriteria Penilaian Sumatif', {
              bold: true,
              spacingBefore: 140,
              spacingAfter: 120,
            }),
            this.renderIntraBulletList(summative.criteria),
          ].join('')
        : '',
      this.renderIntraKeyValueTable(summative.achievementLevels, {
        labelWidth: 2500,
        valueWidth: 6500,
      }),
    ].join('');
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

  private recordList(value: unknown): Record<string, unknown>[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => this.recordValue(item))
      .filter((item) => Object.keys(item).length > 0);
  }

  private firstIntraText(...values: unknown[]): string {
    for (const value of values) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return String(value);
      }
      if (typeof value === 'string' && value.trim()) {
        const cleaned = this.cleanInlineText(value, true);
        if (cleaned) {
          return cleaned;
        }
      }
    }
    return '';
  }

  private intraStringList(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => {
        if (typeof item === 'number' && Number.isFinite(item)) {
          return String(item);
        }
        if (typeof item === 'string') {
          return this.cleanInlineText(item, true);
        }
        const record = this.recordValue(item);
        return this.firstIntraText(
          record.description,
          record.prompt,
          record.text,
          record.item,
          record.name,
          record.title,
        );
      })
      .filter(Boolean);
  }

  private formatIntraMeetingCount(value: string): string {
    const cleaned = value.trim();
    if (!cleaned) {
      return '';
    }
    return /^\d+$/.test(cleaned) ? `${cleaned} pertemuan` : cleaned;
  }

  private normalizeIntraMeetingTitle(value: string, order: number): string {
    return value
      .replace(new RegExp(`^\\s*D\\.${order}\\s*[-–—:]?\\s*`, 'i'), '')
      .replace(new RegExp(`^\\s*Pertemuan\\s+${order}\\s*[-–—:]\\s*`, 'i'), '')
      .replace(
        new RegExp(`^\\s*LKPD\\s+Pertemuan\\s+${order}\\s*[-–—:]?\\s*`, 'i'),
        '',
      )
      .replace(/^\s*LKPD\s*[-–—:]?\s*/i, '')
      .trim();
  }

  private renderIntraFinalFooter(title: string): string {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/><w:spacing w:after="0"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:color w:val="6B7280"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:t xml:space="preserve">${this.escapeXml(
      `RPP Intrakurikuler - ${title} | Halaman `,
    )}</w:t></w:r><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:color w:val="6B7280"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:color w:val="6B7280"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:instrText xml:space="preserve">PAGE</w:instrText></w:r><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/><w:color w:val="6B7280"/><w:sz w:val="18"/><w:szCs w:val="18"/></w:rPr><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
  }

  private renderIntraParagraph(
    text: string,
    options: {
      align?: 'left' | 'center' | 'both';
      bold?: boolean;
      color?: string;
      indentLeft?: number;
      justify?: boolean;
      keepNext?: boolean;
      line?: number;
      outlineLevel?: 0 | 1 | 2;
      size?: number;
      spacingAfter?: number;
      spacingBefore?: number;
    } = {},
  ): string {
    const paragraphProperties = [
      `<w:spacing w:before="${options.spacingBefore ?? 0}" w:after="${
        options.spacingAfter ?? 120
      }" w:line="${options.line ?? 360}" w:lineRule="auto"/>`,
      options.keepNext ? '<w:keepNext/>' : '',
      options.outlineLevel !== undefined
        ? `<w:outlineLvl w:val="${options.outlineLevel}"/>`
        : '',
      options.align
        ? `<w:jc w:val="${options.align}"/>`
        : options.justify
          ? '<w:jc w:val="both"/>'
          : '',
      options.indentLeft ? `<w:ind w:left="${options.indentLeft}"/>` : '',
    ].join('');

    return `<w:p><w:pPr>${paragraphProperties}</w:pPr>${this.renderIntraRuns(
      text,
      {
        bold: options.bold,
        color: options.color ?? '555555',
        size: options.size ?? 24,
      },
    )}</w:p>`;
  }

  private renderIntraStepParagraph(
    stepNumber: number,
    text: string,
    options: {
      justify?: boolean;
      line?: number;
      spacingAfter?: number;
      spacingBefore?: number;
    } = {},
  ): string {
    const paragraphProperties = [
      `<w:spacing w:before="${options.spacingBefore ?? 0}" w:after="${
        options.spacingAfter ?? 120
      }" w:line="${options.line ?? 360}" w:lineRule="auto"/>`,
      options.justify ? '<w:jc w:val="both"/>' : '',
    ].join('');

    return `<w:p><w:pPr>${paragraphProperties}</w:pPr>${this.renderIntraRuns(
      `Langkah\u00A0-\u00A0${stepNumber}`,
      {
        bold: true,
        color: '4D88CF',
        size: 24,
      },
    )}${this.renderIntraRuns(` ${text}`, {
      color: '555555',
      size: 24,
    })}</w:p>`;
  }

  private renderIntraRuns(
    text: string,
    options: { bold?: boolean; color: string; size: number },
  ): string {
    const segments = this.parseInlineSegments(text || ' ');
    return segments
      .map((segment) => {
        const runProperties = [
          '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>',
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

  private renderIntraHeading(
    text: string,
    level: 1 | 2,
    options: { spacingBefore?: number } = {},
  ): string {
    return this.renderIntraParagraph(text, {
      bold: true,
      color: level === 1 ? '000000' : TEMPLATE_BLUE,
      keepNext: true,
      outlineLevel: level === 1 ? 0 : 1,
      size: level === 1 ? 26 : 24,
      spacingBefore: options.spacingBefore ?? (level === 1 ? 240 : 180),
      spacingAfter: level === 1 ? 260 : 170,
    });
  }

  private renderIntraTocEntry(
    text: string,
    page: number,
    level: 1 | 2,
  ): string {
    const indent = level === 1 ? 0 : 360;
    const paragraphProperties = [
      '<w:spacing w:before="0" w:after="80" w:line="300" w:lineRule="auto"/>',
      `<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9000"/></w:tabs>`,
      indent ? `<w:ind w:left="${indent}"/>` : '',
    ].join('');

    return `<w:p><w:pPr>${paragraphProperties}</w:pPr>${this.renderIntraRuns(
      text,
      {
        bold: true,
        color: TEMPLATE_BLUE,
        size: 24,
      },
    )}<w:r><w:tab/></w:r>${this.renderIntraRuns(String(page), {
      bold: true,
      color: TEMPLATE_BLUE,
      size: 24,
    })}</w:p>`;
  }

  private renderIntraSpacer(height: number): string {
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="${height}"/></w:pPr></w:p>`;
  }

  private renderIntraKeyValueTable(
    rows: IntraFinalTableRow[],
    options: {
      header?: [string, string];
      labelWidth?: number;
      useRowsAsSingleHeaderBody?: boolean;
      valueWidth?: number;
    } = {},
  ): string {
    const filteredRows = rows.length > 0 ? rows : [{ label: '-', value: '-' }];
    const labelWidth = options.labelWidth ?? 4500;
    const valueWidth = options.valueWidth ?? 4500;

    if (options.useRowsAsSingleHeaderBody && filteredRows.length >= 2) {
      const [left, right] = filteredRows;
      return this.renderIntraTable(
        [
          `<w:tr>${this.renderIntraCell(left.label, {
            align: 'center',
            bold: true,
            color: TEMPLATE_BLUE,
            fill: 'E8F3FE',
            width: labelWidth,
          })}${this.renderIntraCell(right.label, {
            align: 'center',
            bold: true,
            color: '6D8B2D',
            fill: 'E8F4ED',
            width: valueWidth,
          })}</w:tr>`,
          `<w:tr>${this.renderIntraCell(left.value, {
            width: labelWidth,
          })}${this.renderIntraCell(right.value, {
            width: valueWidth,
          })}</w:tr>`,
        ].join(''),
        [labelWidth, valueWidth],
      );
    }

    const header = options.header
      ? `<w:tr>${this.renderIntraCell(options.header[0], {
          align: 'center',
          bold: true,
          color: TEMPLATE_BLUE,
          fill: 'F8FAFA',
          width: labelWidth,
        })}${this.renderIntraCell(options.header[1], {
          align: 'center',
          bold: true,
          color: TEMPLATE_BLUE,
          fill: 'F8FAFA',
          width: valueWidth,
        })}</w:tr>`
      : '';
    const tableRows = filteredRows
      .map(
        (row) =>
          `<w:tr>${this.renderIntraCell(row.label, {
            bold: true,
            color: TEMPLATE_BLUE,
            fill: 'F8FAFA',
            width: labelWidth,
          })}${this.renderIntraCell(row.value, { width: valueWidth })}</w:tr>`,
      )
      .join('');

    return this.renderIntraTable(`${header}${tableRows}`, [
      labelWidth,
      valueWidth,
    ]);
  }

  private renderIntraTable(rows: string, grid: number[], width = 9000): string {
    return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D5DFDA"/><w:left w:val="single" w:sz="4" w:color="D5DFDA"/><w:bottom w:val="single" w:sz="4" w:color="D5DFDA"/><w:right w:val="single" w:sz="4" w:color="D5DFDA"/><w:insideH w:val="single" w:sz="4" w:color="D5DFDA"/><w:insideV w:val="single" w:sz="4" w:color="D5DFDA"/></w:tblBorders><w:tblCellMar><w:top w:w="95" w:type="dxa"/><w:left w:w="140" w:type="dxa"/><w:bottom w:w="95" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid
      .map((item) => `<w:gridCol w:w="${item}"/>`)
      .join('')}</w:tblGrid>${rows}</w:tbl>`;
  }

  private renderIntraBorderOnlyTable(
    rows: string,
    grid: number[],
    width = 9000,
  ): string {
    return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders><w:top w:val="single" w:sz="6" w:color="D5DFDA"/><w:left w:val="single" w:sz="6" w:color="D5DFDA"/><w:bottom w:val="single" w:sz="6" w:color="D5DFDA"/><w:right w:val="single" w:sz="6" w:color="D5DFDA"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblCellMar><w:top w:w="110" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="110" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid
      .map((item) => `<w:gridCol w:w="${item}"/>`)
      .join('')}</w:tblGrid>${rows}</w:tbl>`;
  }

  private renderIntraCell(
    text: string,
    options: {
      align?: 'center';
      bold?: boolean;
      color?: string;
      fill?: string;
      outlineLevel?: 0 | 1 | 2;
      width: number;
    },
  ): string {
    const cellProperties = [
      `<w:tcW w:w="${options.width}" w:type="dxa"/>`,
      options.fill ? `<w:shd w:fill="${options.fill}"/>` : '',
      '<w:vAlign w:val="center"/>',
    ].join('');
    return `<w:tc><w:tcPr>${cellProperties}</w:tcPr>${this.renderIntraParagraph(
      text,
      {
        align: options.align,
        bold: options.bold,
        color: options.color ?? '555555',
        outlineLevel: options.outlineLevel,
        size: 24,
        spacingAfter: 0,
      },
    )}</w:tc>`;
  }

  private renderIntraImageParagraph(
    relationshipId: string,
    name: string,
    sizeEmu: number,
  ): string {
    return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="0"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${sizeEmu}" cy="${sizeEmu}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="30" name="${this.escapeXml(
      name,
    )}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="30" name="${this.escapeXml(
      name,
    )}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${sizeEmu}" cy="${sizeEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }

  private renderIntraBox(title: string, content: string): string {
    const body = [
      this.renderIntraParagraph(title, {
        bold: true,
        color: TEMPLATE_ORANGE,
        keepNext: true,
        spacingAfter: 100,
      }),
      content,
    ].join('');

    return this.renderIntraTable(
      `<w:tr>${this.renderIntraContentCell(body, {
        fill: 'FBF8EF',
        width: 9000,
      })}</w:tr>`,
      [9000],
    );
  }

  private renderIntraDiagnosticQuestionBox(
    sampleQuestion: string,
    answerOptions: string[],
    correctAnswer: string,
    withQuestionIcon: boolean,
  ): string {
    const iconCell = withQuestionIcon
      ? this.renderIntraContentCell(
          this.renderIntraImageParagraph(
            'rIdQuestionIcon',
            'Question Icon',
            850000,
          ),
          {
            fill: 'FBF8EF',
            width: 1500,
          },
        )
      : '';
    const answerContent = [
      answerOptions.length
        ? this.renderIntraParagraph('Pilih jawaban yang paling tepat.', {
            spacingAfter: 70,
          })
        : '',
      this.renderIntraPlainList(answerOptions),
      correctAnswer
        ? this.renderIntraParagraph(
            `Jawaban yang diharapkan: ${correctAnswer}`,
            { spacingAfter: 0 },
          )
        : '',
    ].join('');
    const contentCell = this.renderIntraContentCell(
      [
        this.renderIntraParagraph('Contoh Soal Diagnostik Berbasis Kertas', {
          bold: true,
          color: '6D8B2D',
          keepNext: true,
          spacingAfter: 90,
        }),
        this.renderIntraParagraph(sampleQuestion, {
          justify: true,
          spacingAfter: answerContent ? 130 : 0,
        }),
        answerContent,
      ].join(''),
      {
        fill: 'FBF8EF',
        width: withQuestionIcon ? 7500 : 9000,
      },
    );

    return this.renderIntraBorderOnlyTable(
      `<w:tr>${iconCell}${contentCell}</w:tr>`,
      withQuestionIcon ? [1500, 7500] : [9000],
    );
  }

  private renderIntraQuestionListBox(
    title: string,
    questions: string[],
    withQuestionIcon: boolean,
  ): string {
    const iconCell = withQuestionIcon
      ? this.renderIntraContentCell(
          this.renderIntraImageParagraph(
            'rIdQuestionIcon',
            'Question Icon',
            850000,
          ),
          {
            fill: 'FBF8EF',
            width: 1500,
          },
        )
      : '';
    const contentCell = this.renderIntraContentCell(
      [
        this.renderIntraParagraph(title, {
          bold: true,
          color: TEMPLATE_ORANGE,
          keepNext: true,
          spacingAfter: 120,
        }),
        this.renderIntraNumberedList(questions),
      ].join(''),
      {
        fill: 'FBF8EF',
        width: withQuestionIcon ? 7500 : 9000,
      },
    );

    return this.renderIntraBorderOnlyTable(
      `<w:tr>${iconCell}${contentCell}</w:tr>`,
      withQuestionIcon ? [1500, 7500] : [9000],
    );
  }

  private renderIntraSummativeProvisionBox(
    provision: string,
    withBookIcon: boolean,
  ): string {
    const iconCell = withBookIcon
      ? this.renderIntraContentCell(
          this.renderIntraImageParagraph('rIdBookIcon', 'Book Icon', 850000),
          {
            fill: 'FBF8EF',
            width: 1500,
          },
        )
      : '';
    const contentCell = this.renderIntraContentCell(
      [
        this.renderIntraParagraph('Ketentuan', {
          bold: true,
          color: TEMPLATE_ORANGE,
          keepNext: true,
          size: 24,
          spacingAfter: 90,
        }),
        this.renderIntraParagraph(provision, {
          color: '111827',
          justify: true,
          spacingAfter: 0,
        }),
      ].join(''),
      {
        fill: 'FBF8EF',
        width: withBookIcon ? 7500 : 9000,
      },
    );

    return this.renderIntraBorderOnlyTable(
      `<w:tr>${iconCell}${contentCell}</w:tr>`,
      withBookIcon ? [1500, 7500] : [9000],
    );
  }

  private renderIntraApplyingSummaryBox(items: string[]): string {
    return this.renderIntraApplyingInfoBox(
      'Ringkasan Alur Mengaplikasi',
      this.renderIntraBulletList(items, {
        bulletIndent: 250,
        spacingAfter: 70,
      }),
      { spacingBefore: 170 },
    );
  }

  private renderIntraApplyingProductBox(product: string): string {
    return [
      this.renderIntraSpacer(180),
      this.renderIntraApplyingInfoBox(
        'Produk/Kinerja yang Dikumpulkan',
        this.renderIntraParagraph(product, {
          color: '222222',
          spacingAfter: 0,
        }),
      ),
    ].join('');
  }

  private renderIntraApplyingInfoBox(
    title: string,
    content: string,
    options: { spacingBefore?: number } = {},
  ): string {
    const body = [
      this.renderIntraParagraph(title, {
        bold: true,
        color: TEMPLATE_BLUE,
        keepNext: true,
        size: 24,
        spacingAfter: 130,
        spacingBefore: options.spacingBefore ?? 0,
      }),
      content,
    ].join('');

    return this.renderIntraTable(
      `<w:tr><w:trPr><w:cantSplit/></w:trPr>${this.renderIntraContentCell(
        body,
        {
          fill: 'EAF5F8',
          width: 9000,
        },
      )}</w:tr>`,
      [9000],
    );
  }

  private renderIntraFormativeIndicatorsBox(items: string[]): string {
    const body = [
      this.renderIntraParagraph('Indikator yang Diamati Guru', {
        bold: true,
        color: TEMPLATE_BLUE,
        keepNext: true,
        size: 24,
        spacingAfter: 120,
      }),
      this.renderIntraBulletList(items, {
        bulletIndent: 250,
        spacingAfter: 60,
      }),
    ].join('');

    return this.renderIntraTable(
      `<w:tr><w:trPr><w:cantSplit/></w:trPr>${this.renderIntraContentCell(
        body,
        {
          fill: 'EAF5F8',
          width: 9000,
        },
      )}</w:tr>`,
      [9000],
    );
  }

  private renderIntraFormativeRecordBox(recordFormat: string): string {
    const body = [
      this.renderIntraParagraph('Bentuk Catatan Formatif', {
        bold: true,
        color: '6D8B2D',
        keepNext: true,
        size: 24,
        spacingAfter: 100,
      }),
      this.renderIntraParagraph(recordFormat, {
        color: '222222',
        justify: true,
        spacingAfter: 0,
      }),
    ].join('');

    return [
      this.renderIntraSpacer(180),
      this.renderIntraTable(
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>${this.renderIntraContentCell(
          body,
          {
            fill: 'FBF8EF',
            width: 9000,
          },
        )}</w:tr>`,
        [9000],
      ),
    ].join('');
  }

  private renderIntraEnrichmentExampleBox(enrichmentExample: string): string {
    const body = [
      this.renderIntraParagraph('Contoh Pengayaan', {
        bold: true,
        color: '6D8B2D',
        keepNext: true,
        size: 24,
        spacingAfter: 150,
      }),
      this.renderIntraParagraph(enrichmentExample, {
        color: '111827',
        justify: true,
        spacingAfter: 0,
      }),
    ].join('');

    return [
      this.renderIntraSpacer(280),
      this.renderIntraTable(
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>${this.renderIntraContentCell(
          body,
          {
            fill: 'F6FAF7',
            width: 9000,
          },
        )}</w:tr>`,
        [9000],
      ),
    ].join('');
  }

  private renderIntraFinalFlowSummaryBox(finalFlowSummary: string): string {
    const body = [
      this.renderIntraParagraph('Ringkasan Alur Final', {
        bold: true,
        color: TEMPLATE_ORANGE,
        keepNext: true,
        size: 24,
        spacingAfter: 150,
      }),
      this.renderIntraParagraph(finalFlowSummary, {
        color: '111827',
        justify: true,
        spacingAfter: 0,
      }),
    ].join('');

    return [
      this.renderIntraSpacer(420),
      this.renderIntraTable(
        `<w:tr><w:trPr><w:cantSplit/></w:trPr>${this.renderIntraContentCell(
          body,
          {
            fill: 'FBF8EF',
            width: 9000,
          },
        )}</w:tr>`,
        [9000],
      ),
    ].join('');
  }

  private renderIntraTeacherNoteBox(
    note: string,
    withWarningIcon: boolean,
  ): string {
    const iconCell = withWarningIcon
      ? this.renderIntraContentCell(
          this.renderIntraImageParagraph(
            'rIdWarningIcon',
            'Warning Icon',
            850000,
          ),
          {
            fill: 'F4DCDC',
            width: 1500,
          },
        )
      : '';
    const contentCell = this.renderIntraContentCell(
      [
        this.renderIntraParagraph('Catatan Penting untuk Guru', {
          bold: true,
          color: 'C94742',
          keepNext: true,
          spacingAfter: 120,
        }),
        this.renderIntraParagraph(note, {
          justify: true,
          spacingAfter: 0,
        }),
      ].join(''),
      {
        fill: 'F4DCDC',
        width: withWarningIcon ? 7500 : 9000,
      },
    );

    return this.renderIntraBorderOnlyTable(
      `<w:tr>${iconCell}${contentCell}</w:tr>`,
      withWarningIcon ? [1500, 7500] : [9000],
    );
  }

  private renderIntraLearningObjectivesBox(items: string[]): string {
    const body =
      items.length > 0
        ? this.renderIntraBulletList(items, {
            bulletIndent: 260,
            spacingAfter: 70,
          })
        : this.renderIntraParagraph('-', { spacingAfter: 0 });

    return this.renderIntraTable(
      [
        `<w:tr>${this.renderIntraContentCell(
          this.renderIntraParagraph('Tujuan Pembelajaran Turunan (TP)', {
            bold: true,
            color: '4D88CF',
            keepNext: true,
            size: 24,
            spacingAfter: 0,
          }),
          {
            fill: 'EAF5F8',
            width: 9000,
          },
        )}</w:tr>`,
        `<w:tr>${this.renderIntraContentCell(body, {
          width: 9000,
        })}</w:tr>`,
      ].join(''),
      [9000],
    );
  }

  private renderIntraPedagogicalPracticeBox(
    description: string,
    forms: IntraFinalTableRow[],
  ): string {
    const headerRows = [
      `<w:tr>${this.renderIntraContentCell(
        this.renderIntraParagraph('Deskripsi Praktik Pedagogis', {
          bold: true,
          color: '6D8B2D',
          keepNext: true,
          size: 24,
          spacingAfter: 0,
        }),
        {
          fill: 'FBF8EF',
          width: 9000,
        },
      )}</w:tr>`,
      `<w:tr>${this.renderIntraContentCell(
        this.renderIntraParagraph(description || '-', {
          justify: true,
          spacingAfter: 0,
        }),
        {
          width: 9000,
        },
      )}</w:tr>`,
      `<w:tr>${this.renderIntraContentCell(
        this.renderIntraParagraph('Bentuk Praktik Pedagogis', {
          bold: true,
          color: '6D8B2D',
          keepNext: true,
          size: 24,
          spacingAfter: 0,
        }),
        {
          fill: 'FBF8EF',
          width: 9000,
        },
      )}</w:tr>`,
    ].join('');
    const formColors = ['2A8A9A', TEMPLATE_ORANGE, '6C4B8F'];
    const formContent =
      forms.length > 0
        ? forms
            .map((row, index) =>
              [
                this.renderIntraParagraph(row.label, {
                  bold: true,
                  color: formColors[index % formColors.length],
                  keepNext: true,
                  spacingAfter: 70,
                }),
                this.renderIntraParagraph(row.value, {
                  justify: true,
                  spacingAfter: 180,
                }),
              ].join(''),
            )
            .join('')
        : this.renderIntraParagraph('-', { spacingAfter: 0 });

    return this.renderIntraTable(
      [
        headerRows,
        `<w:tr>${this.renderIntraContentCell(formContent, {
          width: 9000,
        })}</w:tr>`,
      ].join(''),
      [9000],
    );
  }

  private renderIntraContentCell(
    content: string,
    options: { fill?: string; gridSpan?: number; width: number },
  ): string {
    return `<w:tc><w:tcPr><w:tcW w:w="${options.width}" w:type="dxa"/>${
      options.gridSpan ? `<w:gridSpan w:val="${options.gridSpan}"/>` : ''
    }${
      options.fill ? `<w:shd w:fill="${options.fill}"/>` : ''
    }<w:vAlign w:val="top"/></w:tcPr>${content}</w:tc>`;
  }

  private renderIntraDefinitionList(rows: IntraFinalTableRow[]): string {
    return rows
      .map((row) =>
        [
          this.renderIntraParagraph(row.label, {
            bold: true,
            color: TEMPLATE_BLUE,
            spacingAfter: 70,
          }),
          this.renderIntraParagraph(row.value, {
            justify: true,
            spacingAfter: 130,
          }),
        ].join(''),
      )
      .join('');
  }

  private renderIntraBulletList(
    items: string[],
    options: { bulletIndent?: number; spacingAfter?: number } = {},
  ): string {
    return items
      .map((item) =>
        this.renderIntraParagraph(`• ${item}`, {
          indentLeft: options.bulletIndent ?? 280,
          justify: true,
          spacingAfter: options.spacingAfter ?? 80,
        }),
      )
      .join('');
  }

  private renderIntraPlainList(items: string[]): string {
    return items
      .map((item) =>
        this.renderIntraParagraph(item, {
          spacingAfter: 60,
        }),
      )
      .join('');
  }

  private renderIntraNumberedList(items: string[]): string {
    return items
      .map((item, index) =>
        this.renderIntraParagraph(`${index + 1}. ${item}`, {
          indentLeft: 260,
          spacingAfter: 70,
        }),
      )
      .join('');
  }

  private renderIntraMeetingHeader(meeting: IntraFinalMeeting): string {
    const meetingTitle = `Pertemuan ${meeting.order} - ${meeting.title}`;

    return [
      this.renderDocxTocEntryField(meetingTitle, 2),
      this.renderIntraTable(
        `<w:tr>${this.renderIntraCell(`D.${meeting.order}`, {
          align: 'center',
          bold: true,
          color: TEMPLATE_BLUE,
          fill: 'F8FAFA',
          width: 1500,
        })}${this.renderIntraCell(meetingTitle, {
          align: 'center',
          bold: true,
          color: TEMPLATE_BLUE,
          fill: 'F8FAFA',
          outlineLevel: 1,
          width: 7500,
        })}</w:tr>`,
        [1500, 7500],
      ),
    ].join('');
  }

  private renderIntraDifferentiationTable(meeting: IntraFinalMeeting): string {
    return [
      this.renderIntraParagraph('Diferensiasi Tahap Aplikasi', {
        align: 'center',
        bold: true,
        spacingBefore: 160,
        spacingAfter: 120,
      }),
      this.renderIntraBorderlessTable(
        `<w:tr><w:trPr><w:trHeight w:val="1760" w:hRule="atLeast"/></w:trPr>${this.renderIntraDifferentiationCardCell(
          {
            label: 'A',
            title: 'Aplikasi Kelompok A',
            body: meeting.applying.advancedGroup,
            fill: 'EEF6E5',
            border: '8DBB55',
            badge: '4F6F25',
            width: 4320,
          },
        )}${this.renderIntraSpacerCell(360)}${this.renderIntraDifferentiationCardCell(
          {
            label: 'B',
            title: 'Aplikasi Kelompok B',
            body: meeting.applying.supportGroup,
            fill: 'E7F0FA',
            border: '4E82C3',
            badge: '1F4E83',
            width: 4320,
          },
        )}</w:tr>`,
        [4320, 360, 4320],
      ),
    ].join('');
  }

  private renderIntraDifferentiationCardCell(options: {
    label: 'A' | 'B';
    title: string;
    body: string;
    fill: string;
    border: string;
    badge: string;
    width: number;
  }): string {
    const content = [
      this.renderIntraDifferentiationCardHeader(
        options.label,
        options.title,
        options.badge,
      ),
      this.renderIntraParagraph(options.body || '-', {
        color: '000000',
        justify: true,
        line: 285,
        size: 22,
        spacingAfter: 0,
        spacingBefore: 130,
      }),
    ].join('');

    return `<w:tc><w:tcPr><w:tcW w:w="${options.width}" w:type="dxa"/><w:shd w:fill="${options.fill}"/><w:vAlign w:val="top"/><w:tcBorders><w:top w:val="single" w:sz="8" w:color="${options.border}"/><w:left w:val="single" w:sz="8" w:color="${options.border}"/><w:bottom w:val="single" w:sz="8" w:color="${options.border}"/><w:right w:val="single" w:sz="8" w:color="${options.border}"/></w:tcBorders><w:tcMar><w:top w:w="220" w:type="dxa"/><w:left w:w="250" w:type="dxa"/><w:bottom w:w="220" w:type="dxa"/><w:right w:w="250" w:type="dxa"/></w:tcMar></w:tcPr>${content}</w:tc>`;
  }

  private renderIntraDifferentiationCardHeader(
    label: 'A' | 'B',
    title: string,
    badgeFill: string,
  ): string {
    return this.renderIntraBorderlessTable(
      `<w:tr>${this.renderIntraBadgeCell(label, badgeFill)}${this.renderIntraSpacerCell(
        160,
      )}${this.renderIntraContentCell(
        this.renderIntraParagraph(title, {
          bold: true,
          color: '000000',
          line: 280,
          size: 24,
          spacingAfter: 0,
        }),
        {
          width: 2940,
        },
      )}</w:tr>`,
      [620, 160, 2940],
      3720,
    );
  }

  private renderIntraBadgeCell(label: string, fill: string): string {
    return `<w:tc><w:tcPr><w:tcW w:w="520" w:type="dxa"/><w:shd w:fill="${fill}"/><w:vAlign w:val="center"/><w:tcMar><w:top w:w="90" w:type="dxa"/><w:left w:w="90" w:type="dxa"/><w:bottom w:w="90" w:type="dxa"/><w:right w:w="90" w:type="dxa"/></w:tcMar></w:tcPr>${this.renderIntraParagraph(
      label,
      {
        align: 'center',
        bold: true,
        color: 'FFFFFF',
        line: 240,
        size: 20,
        spacingAfter: 0,
      },
    )}</w:tc>`;
  }

  private renderIntraSpacerCell(width: number): string {
    return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/></w:tcBorders></w:tcPr><w:p/></w:tc>`;
  }

  private renderIntraBorderlessTable(
    rows: string,
    grid: number[],
    width = 9000,
  ): string {
    return `<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:jc w:val="center"/><w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${grid
      .map((item) => `<w:gridCol w:w="${item}"/>`)
      .join('')}</w:tblGrid>${rows}</w:tbl>`;
  }

  private renderIntraReflectionTable(questions: string[]): string {
    return this.renderIntraTable(
      (questions.length ? questions : ['Apakah tujuan pembelajaran tercapai?'])
        .map(
          (question) =>
            `<w:tr>${this.renderIntraCell(question, {
              bold: true,
              color: TEMPLATE_BLUE,
              fill: 'F8FAFA',
              width: 3100,
            })}${this.renderIntraCell('', { width: 5900 })}</w:tr>`,
        )
        .join(''),
      [3100, 5900],
    );
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

  private loadQuestionIconImage(): Buffer | undefined {
    const candidates = [
      resolve(__dirname, 'assets/questionicon.png'),
      resolve(process.cwd(), 'src/modules/documents/assets/questionicon.png'),
      resolve(process.cwd(), 'assets/documents/questionicon.png'),
      resolve(process.cwd(), 'questionicon.png'),
      resolve(process.cwd(), '../questionicon.png'),
    ];
    const iconPath = candidates.find(
      (candidate) => candidate.endsWith('.png') && existsSync(candidate),
    );

    if (!iconPath) {
      this.logger.warn(
        'questionicon.png tidak ditemukan. Box diagnostik dibuat tanpa icon.',
      );
      return undefined;
    }

    return readFileSync(iconPath);
  }

  private loadWarningIconImage(): Buffer | undefined {
    const candidates = [
      resolve(__dirname, 'assets/warningicon.png'),
      resolve(process.cwd(), 'src/modules/documents/assets/warningicon.png'),
      resolve(process.cwd(), 'assets/documents/warningicon.png'),
      resolve(process.cwd(), 'warningicon.png'),
      resolve(process.cwd(), '../warningicon.png'),
    ];
    const iconPath = candidates.find(
      (candidate) => candidate.endsWith('.png') && existsSync(candidate),
    );

    if (!iconPath) {
      this.logger.warn(
        'warningicon.png tidak ditemukan. Box catatan guru dibuat tanpa icon.',
      );
      return undefined;
    }

    return readFileSync(iconPath);
  }

  private loadBookIconImage(): Buffer | undefined {
    const candidates = [
      resolve(__dirname, 'assets/bookicon.png'),
      resolve(process.cwd(), 'src/modules/documents/assets/bookicon.png'),
      resolve(process.cwd(), 'assets/documents/bookicon.png'),
      resolve(process.cwd(), 'bookicon.png'),
      resolve(process.cwd(), '../bookicon.png'),
    ];
    const iconPath = candidates.find(
      (candidate) => candidate.endsWith('.png') && existsSync(candidate),
    );

    if (!iconPath) {
      this.logger.warn(
        'bookicon.png tidak ditemukan. Box ketentuan sumatif dibuat tanpa icon.',
      );
      return undefined;
    }

    return readFileSync(iconPath);
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
      : [educationLevel, phase].filter(Boolean).join(' - ') || subject || 'RPM';
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
        'RPM - Intrakurikuler',
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
      : [educationLevel, phase].filter(Boolean).join(' - ') || subject || 'RPM';
    const meetingLabel =
      meetingCount && timeAllocation
        ? `${meetingCount} Pertemuan x ${timeAllocation}`
        : timeAllocation ||
          (meetingCount ? `${meetingCount} Pertemuan` : 'Pembelajaran');
    const typeLabel =
      this.usableMetadataValue(identity.rppType) || 'Intrakurikuler';

    return [
      withImage ? this.renderDocxCoverImage() : '',
      this.renderDocxParagraph('RPM - Intrakurikuler', {
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
      `RPM Intrakurikuler - ${footerTitle} | Halaman `,
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

  private renderDocxAutomaticTableOfContents(): string {
    return `<w:p><w:pPr><w:spacing w:before="0" w:after="120" w:line="300" w:lineRule="auto"/></w:pPr><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve">TOC \\o "1-2" \\h \\z \\u \\f</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${this.renderIntraRuns(
      'Daftar isi akan diperbarui otomatis saat dokumen dibuat.',
      {
        color: TEMPLATE_BLUE,
        size: 22,
      },
    )}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
  }

  private renderDocxTocEntryField(text: string, level: 1 | 2): string {
    const instruction = `TC "${text.replace(/"/g, "'")}" \\l ${level}`;

    return `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/></w:pPr><w:fldSimple w:instr="${this.escapeXml(
      instruction,
    )}"><w:r><w:rPr><w:vanish/></w:rPr><w:t> </w:t></w:r></w:fldSimple></w:p>`;
  }

  private renderDocxUpdateFieldsSettings(): string {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:updateFields w:val="true"/></w:settings>';
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
      rppType: 'Jenis RPM',
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
