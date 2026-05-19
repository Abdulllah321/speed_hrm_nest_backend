import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EOBIService } from './eobi.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@ApiTags('EOBI')
@Controller('api/eobi')
export class EOBIController {
  constructor(private readonly eobiService: EOBIService) {}

  @Get('employees')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('hr.eobi.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get EOBI balances for all employees' })
  @ApiResponse({
    status: 200,
    description: 'Returns EOBI balance data for employees',
  })
  async getEOBIEmployees() {
    return this.eobiService.getEOBIEmployees();
  }

  @Post('withdrawals')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('hr.eobi.create')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create EOBI withdrawal' })
  @ApiResponse({
    status: 201,
    description: 'EOBI withdrawal created successfully',
  })
  async createEOBIWithdrawal(
    @Body('employeeId') employeeId: string,
    @Body('withdrawalAmount') withdrawalAmount: number,
    @Body('month') month: string,
    @Body('year') year: string,
    @Body('reason') reason?: string,
    @Body('createdById') createdById?: string,
  ) {
    return this.eobiService.createEOBIWithdrawal({
      employeeId,
      withdrawalAmount,
      month,
      year,
      reason,
      createdById,
    });
  }

  @Get('withdrawals')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('hr.eobi.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all EOBI withdrawals' })
  @ApiResponse({ status: 200, description: 'Returns list of EOBI withdrawals' })
  async getEOBIWithdrawals(
    @Query('employeeId') employeeId?: string,
    @Query('departmentId') departmentId?: string,
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('status') status?: string,
  ) {
    return this.eobiService.getEOBIWithdrawals({
      employeeId,
      departmentId,
      month,
      year,
      status,
    });
  }
}
