import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SchoolService } from './school.service';
import { CreateSchoolDto } from './dto/create-school.dto';
import { UpdateSchoolDto } from './dto/update-school.dto';
import { SearchSchoolDto } from './dto/search-school.dto';

@ApiTags('schools')
@ApiBearerAuth('supabase')
@Controller('schools')
export class SchoolController {
  constructor(private readonly schoolService: SchoolService) {}

  @ApiOperation({ summary: 'Buat data sekolah baru' })
  @Post()
  create(@Body() dto: CreateSchoolDto) {
    return this.schoolService.create(dto);
  }

  @ApiOperation({ summary: 'Cari data sekolah dengan filter dan pagination' })
  @Get('search')
  search(@Query() dto: SearchSchoolDto) {
    return this.schoolService.search(dto);
  }

  @ApiOperation({ summary: 'Ambil detail sekolah berdasarkan ID' })
  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.schoolService.findById(id);
  }

  @ApiOperation({ summary: 'Update data sekolah berdasarkan ID' })
  @Put(':id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateSchoolDto) {
    return this.schoolService.update(id, dto);
  }
}
