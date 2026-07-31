import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CprService } from './cpr.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CreateCprDto, UpdateCprDto } from './dto/cpr.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('CPR Tax')
@Controller('api')
export class CprController {
  constructor(private readonly service: CprService) {}

  @Post('cpr-tax')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('hr.payroll.create')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create CPR Tax record' })
  @ApiResponse({ status: 201, description: 'CPR Tax record created successfully' })
  async create(@Body() body: CreateCprDto) {
    const data = await this.service.create(body);
    return { status: true, data, message: 'CPR Tax record created successfully' };
  }

  @Get('cpr-tax')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('hr.payroll.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all CPR Tax records' })
  @ApiResponse({ status: 200, description: 'Returns list of CPR Tax records' })
  async list(
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('months') months?: string,
  ) {
    const data = await this.service.list({ month, year, months });
    return { status: true, data, message: 'CPR Tax records fetched successfully' };
  }

  @Get('cpr-tax/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('hr.payroll.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get CPR Tax record by ID' })
  @ApiResponse({ status: 200, description: 'Returns CPR Tax record details' })
  async get(@Param('id') id: string) {
    const data = await this.service.get(id);
    return { status: true, data, message: 'CPR Tax record fetched successfully' };
  }

  @Put('cpr-tax/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('hr.payroll.create')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update CPR Tax record' })
  @ApiResponse({ status: 200, description: 'CPR Tax record updated successfully' })
  async update(@Param('id') id: string, @Body() body: UpdateCprDto) {
    const data = await this.service.update(id, body);
    return { status: true, data, message: 'CPR Tax record updated successfully' };
  }

  @Delete('cpr-tax/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('hr.payroll.create')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete CPR Tax record' })
  @ApiResponse({ status: 200, description: 'CPR Tax record deleted successfully' })
  async delete(@Param('id') id: string) {
    const data = await this.service.delete(id);
    return { status: true, data, message: 'CPR Tax record deleted successfully' };
  }
}
