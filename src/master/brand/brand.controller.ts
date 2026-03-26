import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
  Req,
} from '@nestjs/common';
import { BrandService } from './brand.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  UpdateBrandDto,
  BulkUpdateBrandDto,
  CreateBrandDto,
} from './dto/brand.dto';
import {
  CreateDivisionDto,
  UpdateDivisionDto,
  BulkUpdateDivisionDto,
} from './dto/division.dto';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';

@ApiTags('Brand')
@Controller('api')
export class BrandController {
  constructor(private service: BrandService) {}

  // --- BRANDS ---

  @Get('brands')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all brands' })
  async list() {
    return this.service.getAllBrands();
  }

  @Get('brands/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get brand by id' })
  async get(@Param('id') id: string) {
    return this.service.getBrandById(id);
  }

  @Post('brands')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create brands in bulk' })
  @ApiBody({ type: [CreateBrandDto] })
  async createBulk(@Body() body: { items: CreateBrandDto[] }, @Req() req) {
    return this.service.createBrands(body.items || [], req.user.userId);
  }

  @Put('brands/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update brands in bulk' })
  @ApiBody({ type: BulkUpdateBrandDto })
  async updateBulk(@Body() body: BulkUpdateBrandDto, @Req() req) {
    return this.service.updateBrands(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('brands/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update brand' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateBrandDto,
    @Req() req,
  ) {
    return this.service.updateBrand(id, dto, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('brands/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete brands in bulk' })
  async deleteBulk(@Body() body: { ids: string[] }, @Req() req) {
    return this.service.deleteBrands(body.ids || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('brands/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete brand' })
  async delete(@Param('id') id: string, @Req() req) {
    return this.service.deleteBrand(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  // --- DIVISIONS ---

  @Get('divisions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all divisions' })
  async listDivisions() {
    return this.service.getAllDivisions();
  }

  @Get('divisions/brand/:brandId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List divisions by brand' })
  async listDivisionsByBrand(@Param('brandId') brandId: string) {
    return this.service.getDivisionsByBrand(brandId);
  }

  @Post('divisions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create divisions' })
  @ApiBody({ type: [CreateDivisionDto] })
  async createDivisions(
    @Body() body: { items: CreateDivisionDto[] },
    @Req() req,
  ) {
    return this.service.createDivisions(body.items || [], req.user.userId);
  }

  @Put('divisions/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update divisions in bulk' })
  @ApiBody({ type: BulkUpdateDivisionDto })
  async updateDivisionsBulk(@Body() body: BulkUpdateDivisionDto, @Req() req) {
    return this.service.updateDivisions(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('divisions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update division' })
  async updateDivision(
    @Param('id') id: string,
    @Body() dto: UpdateDivisionDto,
    @Req() req,
  ) {
    return this.service.updateDivision(id, dto, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('divisions/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete divisions in bulk' })
  async deleteDivisionsBulk(@Body() body: { ids: string[] }, @Req() req) {
    return this.service.deleteDivisions(body.ids || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('divisions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete division' })
  async deleteDivision(@Param('id') id: string, @Req() req) {
    return this.service.deleteDivision(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
