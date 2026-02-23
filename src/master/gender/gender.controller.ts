import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { GenderService } from './gender.service';
import {
  CreateGenderDto,
  UpdateGenderDto,
  BulkUpdateGenderItemDto,
} from './dto/gender.dto';

@ApiTags('Gender')
@ApiBearerAuth()
@Controller('api')
export class GenderController {
  constructor(private readonly genderService: GenderService) {} // recompile trigger

  @Get('genders')
  @ApiOperation({ summary: 'Get all genders' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.gender.read'))
  async getAllGenders() {
    return this.genderService.getAllGenders();
  }

  @Get('genders/:id')
  @ApiOperation({ summary: 'Get gender by ID' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.gender.read'))
  async getGenderById(@Param('id') id: string) {
    return this.genderService.getGenderById(id);
  }

  @Post('genders')
  @ApiOperation({ summary: 'Create genders (bulk)' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.gender.create'))
  async createGenders(
    @Body() body: { items: CreateGenderDto[] },
    @Req() req: any,
  ) {
    return this.genderService.createGenders(body.items, req.user.userId);
  }

  @Put('genders/:id')
  @ApiOperation({ summary: 'Update gender' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.gender.update'))
  async updateGender(
    @Param('id') id: string,
    @Body() dto: UpdateGenderDto,
    @Req() req: any,
  ) {
    return this.genderService.updateGender(id, dto, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('genders/bulk/update')
  @ApiOperation({ summary: 'Bulk update genders' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.gender.update'))
  async updateGenders(
    @Body() body: { items: BulkUpdateGenderItemDto[] },
    @Req() req: any,
  ) {
    return this.genderService.updateGenders(body.items, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('genders/bulk/delete')
  @ApiOperation({ summary: 'Bulk delete genders' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.gender.delete'))
  async deleteGenders(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.genderService.deleteGenders(body.ids, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('genders/:id')
  @ApiOperation({ summary: 'Delete gender' })
  @UseGuards(JwtAuthGuard, PermissionGuard('master.gender.delete'))
  async deleteGender(@Param('id') id: string, @Req() req: any) {
    return this.genderService.deleteGender(id, {
      userId: req.user.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
