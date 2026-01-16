import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BonusService } from './bonus.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CreateBonusDto,
  BulkCreateBonusDto,
  UpdateBonusDto,
} from './dto/create-bonus.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';

@ApiTags('Bonus')
@Controller('api')
export class BonusController {
  constructor(private service: BonusService) {}

  @Get('bonuses')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List bonuses' })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'bonusTypeId', required: false })
  @ApiQuery({ name: 'month', required: false })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'bonusMonthYear', required: false })
  @ApiQuery({ name: 'status', required: false })
  async list(
    @Query('employeeId') employeeId?: string,
    @Query('bonusTypeId') bonusTypeId?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('bonusMonthYear') bonusMonthYear?: string,
    @Query('status') status?: string,
  ) {
    return this.service.list({
      employeeId,
      bonusTypeId,
      month,
      year,
      bonusMonthYear,
      status,
    });
  }

  @Get('bonuses/search')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Search bonuses by employees' })
  @ApiQuery({
    name: 'employeeIds',
    required: false,
    description: 'Comma separated IDs',
  })
  @ApiQuery({ name: 'bonusMonthYear', required: false })
  @ApiQuery({ name: 'bonusTypeId', required: false })
  async search(
    @Query('employeeIds') employeeIds?: string,
    @Query('bonusMonthYear') bonusMonthYear?: string,
    @Query('bonusTypeId') bonusTypeId?: string,
  ) {
    const employeeIdsArray = employeeIds
      ? employeeIds.split(',').map((id) => id.trim())
      : [];
    return this.service.searchByEmployees({
      employeeIds: employeeIdsArray,
      bonusMonthYear,
      bonusTypeId,
    });
  }

  @Get('bonuses/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get bonus by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('bonuses/bulk')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create bonuses in bulk' })
  async bulkCreate(@Body() body: BulkCreateBonusDto, @Req() req) {
    return this.service.bulkCreate(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('bonuses')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create bonus' })
  async create(@Body() body: CreateBonusDto, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('bonuses/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update bonus' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateBonusDto,
    @Req() req,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('bonuses/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete bonus' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
