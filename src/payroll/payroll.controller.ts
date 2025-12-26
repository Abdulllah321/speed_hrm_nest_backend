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
}
