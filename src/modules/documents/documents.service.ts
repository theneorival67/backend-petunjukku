import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ExportFileType } from '@prisma/client';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { SupabaseService } from '../../supabase/supabase.service';

@Injectable()
export class DocumentsService {
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
        rppProject: true,
      },
    });

    if (!generated) {
      throw new NotFoundException('Generated RPP tidak ditemukan.');
    }

    const title = generated.rppProject.title;
    const markdown =
      generated.contentMarkdown ||
      this.contentJsonToMarkdown(title, generated.contentJson);
    const buffer =
      fileType === ExportFileType.pdf
        ? this.renderPdf(title, markdown)
        : this.renderDocx(title, markdown);
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

  private renderPdf(title: string, markdown: string): Buffer {
    const lines = [title, '', ...markdown.replace(/\r/g, '').split('\n')]
      .flatMap((line) => this.wrapLine(line, 86))
      .slice(0, 52);
    const escaped = lines
      .map((line, index) => {
        const y = 780 - index * 14;
        return `BT /F1 10 Tf 40 ${y} Td (${this.escapePdf(line)}) Tj ET`;
      })
      .join('\n');
    const objects = [
      '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
      '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
      '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >> endobj',
      '4 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj',
      `5 0 obj << /Length ${Buffer.byteLength(escaped)} >> stream\n${escaped}\nendstream endobj`,
    ];
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

  private renderDocx(title: string, markdown: string): Buffer {
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
${[title, '', ...markdown.replace(/\r/g, '').split('\n')]
  .map(
    (line) =>
      `<w:p><w:r><w:t xml:space="preserve">${this.escapeXml(line)}</w:t></w:r></w:p>`,
  )
  .join('')}
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
