import { Controller, Post, Body, Get, Param, Query } from '@nestjs/common';
import { PayrollService } from './payroll.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';

@ApiTags('Payroll')
@Controller('api')
export class PayrollController {
    constructor(private readonly payrollService: PayrollService) { }

    @Post('payroll/preview')
    @ApiOperation({ summary: 'Preview payroll' })
    @ApiResponse({ status: 200, description: 'Payroll preview generated successfully' })
    async previewPayroll(
        @Body('month') month: string,
        @Body('year') year: string,
        @Body('employeeIds') employeeIds?: string[],
    ) {
        return this.payrollService.previewPayroll(month, year, employeeIds);
    }

    @Post('payroll/confirm')
    @ApiOperation({ summary: 'Confirm payroll' })
    @ApiResponse({ status: 200, description: 'Payroll confirmed successfully' })
    async confirmPayroll(
        @Body('month') month: string,
        @Body('year') year: string,
        @Body('generatedBy') generatedBy: string,
        @Body('details') details: any[],
    ) {
        return this.payrollService.confirmPayroll({ month, year, generatedBy, details });
    }

    @Get('payroll')
    @ApiOperation({ summary: 'Get all payrolls' })
    @ApiResponse({ status: 200, description: 'Returns list of payrolls' })
    async getAllPayrolls(@Query('year') year?: string) {
        return { message: "Use /generate to create payroll" };
    }

    @Get('payroll/:id')
    @ApiOperation({ summary: 'Get payroll by id' })
    @ApiResponse({ status: 200, description: 'Returns payroll details' })
    async getPayrollDetails(@Param('id') id: string) {
        return this.payrollService.getPayrollById(id);
    }

    @Get('payroll/report')
    @ApiOperation({ summary: 'Get payroll report' })
    @ApiResponse({ status: 200, description: 'Returns payroll report data' })
    async getPayrollReport(
        @Query('month') month?: string,
        @Query('year') year?: string,
        @Query('departmentId') departmentId?: string,
        @Query('subDepartmentId') subDepartmentId?: string,
        @Query('employeeId') employeeId?: string,
    ) {
        return this.payrollService.getPayrollReport({ month, year, departmentId, subDepartmentId, employeeId });
    }

    @Get('payroll/bank-report')
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
    @ApiOperation({ summary: 'Get confirmed payrolls for payslips' })
    async getPayslips(
        @Query('month') month?: string,
        @Query('year') year?: string,
        @Query('departmentId') departmentId?: string,
        @Query('subDepartmentId') subDepartmentId?: string,
        @Query('employeeId') employeeId?: string,
    ) {
        return this.payrollService.getPayslips({ month, year, departmentId, subDepartmentId, employeeId });
    }

    @Get('payroll/payslip/:detailId')
    @ApiOperation({ summary: 'Get detailed payslip info' })
    async getPayslipDetail(@Param('detailId') detailId: string) {
        return this.payrollService.getPayslipDetail(detailId);
    }


}
