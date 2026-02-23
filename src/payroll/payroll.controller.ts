import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PayrollService } from './payroll.service';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';

@ApiTags('Payroll')
@Controller('api')
export class PayrollController {
  constructor(private readonly payrollService: PayrollService) {}

  @Post('payroll/preview')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('hr.payroll.create')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Preview payroll' })
  @ApiResponse({
    status: 200,
    description: 'Payroll preview generated successfully',
  })
  async previewPayroll(
    @Body('month') month: string,
    @Body('year') year: string,
    @Body('employeeIds') employeeIds?: string[],
  ) {
    return this.payrollService.previewPayroll(month, year, employeeIds);
  }

  @Post('payroll/confirm')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('hr.payroll.create')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Confirm payroll' })
  @ApiResponse({ status: 200, description: 'Payroll confirmed successfully' })
  async confirmPayroll(
    @Body('month') month: string,
    @Body('year') year: string,
    @Body('generatedBy') generatedBy: string,
    @Body('details') details: any[],
  ) {
    return this.payrollService.confirmPayroll({
      month,
      year,
      generatedBy,
      details,
    });
  }

  @Get('payroll')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('hr.payroll.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all payrolls' })
  @ApiResponse({ status: 200, description: 'Returns list of payrolls' })
  async getAllPayrolls(@Query('year') year?: string) {
    return { message: 'Use /generate to create payroll' };
  }

  @Get('payroll/:id')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('hr.payroll.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get payroll by id' })
  @ApiResponse({ status: 200, description: 'Returns payroll details' })
  async getPayrollDetails(@Param('id') id: string) {
    return this.payrollService.getPayrollById(id);
  }

  @Get('payroll/report')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('hr.payroll.read', 'hr.salary-sheet.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get payroll report' })
  @ApiResponse({ status: 200, description: 'Returns payroll report data' })
  async getPayrollReport(
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('departmentId') departmentId?: string,
    @Query('subDepartmentId') subDepartmentId?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    return this.payrollService.getPayrollReport({
      month,
      year,
      departmentId,
      subDepartmentId,
      employeeId,
    });
  }

  @Get('payroll/bank-report')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('hr.payroll.read', 'hr.salary-sheet.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get bank salary transfer report' })
  @ApiResponse({ status: 200, description: 'Returns bank report data' })
  async getBankReport(
    @Query('month') month: string,
    @Query('year') year: string,
    @Query('bankName') bankName: string,
  ) {
    return this.payrollService.getBankReport({ month, year, bankName });
  }

  @Get('payroll/payslips')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('hr.payroll.read', 'hr.salary-sheet.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get confirmed payrolls for payslips' })
  async getPayslips(
    @Query('month') month?: string,
    @Query('year') year?: string,
    @Query('departmentId') departmentId?: string,
    @Query('subDepartmentId') subDepartmentId?: string,
    @Query('employeeId') employeeId?: string,
  ) {
    return this.payrollService.getPayslips({
      month,
      year,
      departmentId,
      subDepartmentId,
      employeeId,
    });
  }

  @Get('payroll/payslip/:detailId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  @Permissions('hr.payroll.read')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get detailed payslip info' })
  async getPayslipDetail(@Param('detailId') detailId: string) {
    return this.payrollService.getPayslipDetail(detailId);
  }
}
