import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { SearchSchoolDto } from './dto/search-school.dto';

@Injectable()
export class SchoolService {
  private readonly logger = new Logger(SchoolService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /schools
   * Membuat data sekolah baru.
   */
  async create(dto: CreateSchoolDto) {
    // Cek duplikasi NPSN jika diberikan
    if (dto.npsn) {
      const existing = await this.prisma.school.findFirst({
        where: { npsn: dto.npsn },
      });

      if (existing) {
        throw new ConflictException(
          `Sekolah dengan NPSN "${dto.npsn}" sudah terdaftar.`,
        );
      }
    }

    const school = await this.prisma.school.create({
      data: {
        name: dto.name.trim(),
        npsn: dto.npsn?.trim(),
        province: dto.province?.trim(),
        city: dto.city?.trim(),
        district: dto.district?.trim(),
        address: dto.address?.trim(),
        schoolLevel: dto.school_level,
        schoolType: dto.school_type,
      },
    });

    this.logger.log(`Sekolah berhasil dibuat: ${school.id} — ${school.name}`);

    return {
      message: 'Sekolah berhasil dibuat.',
      school,
    };
  }

  /**
   * GET /schools/search
   * Mencari data sekolah dengan filter dan pagination.
   */
  async search(dto: SearchSchoolDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Prisma.SchoolWhereInput = {};

    // Pencarian berdasarkan kata kunci (nama atau NPSN)
    if (dto.q?.trim()) {
      const keyword = dto.q.trim();
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { npsn: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    // Filter berdasarkan provinsi
    if (dto.province?.trim()) {
      where.province = {
        equals: dto.province.trim(),
        mode: 'insensitive',
      };
    }

    // Filter berdasarkan kota
    if (dto.city?.trim()) {
      where.city = {
        equals: dto.city.trim(),
        mode: 'insensitive',
      };
    }

    // Filter berdasarkan jenjang sekolah
    if (dto.school_level) {
      where.schoolLevel = dto.school_level;
    }

    // Filter berdasarkan tipe sekolah
    if (dto.school_type) {
      where.schoolType = dto.school_type;
    }

    const [schools, total] = await Promise.all([
      this.prisma.school.findMany({
        where,
        skip,
        take: limit,
        orderBy: { name: 'asc' },
      }),
      this.prisma.school.count({ where }),
    ]);

    return {
      data: schools,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * GET /schools/:id
   * Mengambil detail sekolah beserta profil guru yang terhubung.
   */
  async findById(id: string) {
    const school = await this.prisma.school.findUnique({
      where: { id },
      include: {
        teacherProfiles: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
      },
    });

    if (!school) {
      throw new NotFoundException('Sekolah tidak ditemukan.');
    }

    return { school };
  }

  /**
   * PUT /schools/:id
   * Mengupdate data sekolah.
   */
  async update(id: string, dto: UpdateSchoolDto) {
    const existing = await this.prisma.school.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException('Sekolah tidak ditemukan.');
    }

    // Cek duplikasi NPSN jika diubah
    if (dto.npsn && dto.npsn !== existing.npsn) {
      const duplicate = await this.prisma.school.findFirst({
        where: {
          npsn: dto.npsn,
          id: { not: id },
        },
      });

      if (duplicate) {
        throw new ConflictException(
          `Sekolah dengan NPSN "${dto.npsn}" sudah terdaftar.`,
        );
      }
    }

    const data: Prisma.SchoolUpdateInput = {};

    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.npsn !== undefined) data.npsn = dto.npsn.trim();
    if (dto.province !== undefined) data.province = dto.province.trim();
    if (dto.city !== undefined) data.city = dto.city.trim();
    if (dto.district !== undefined) data.district = dto.district.trim();
    if (dto.address !== undefined) data.address = dto.address.trim();
    if (dto.school_level !== undefined) data.schoolLevel = dto.school_level;
    if (dto.school_type !== undefined) data.schoolType = dto.school_type;

    const school = await this.prisma.school.update({
      where: { id },
      data,
    });

    this.logger.log(
      `Sekolah berhasil diperbarui: ${school.id} — ${school.name}`,
    );

    return {
      message: 'Sekolah berhasil diperbarui.',
      school,
    };
  }
}
