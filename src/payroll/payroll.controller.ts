import { Controller, Post, Body, Get, Param, Query } from '@nestjs/common';
import { PayrollService } from './payroll.service';

@Controller('api/payroll')
export class PayrollController {
    constructor(private readonly payrollService: PayrollService) { }

    @Post('preview')
    async previewPayroll(
        @Body('month') month: string,
        @Body('year') year: string,
        @Body('employeeIds') employeeIds?: string[],
    ) {
        return this.payrollService.previewPayroll(month, year, employeeIds);
    }

    @Post('confirm')
    async confirmPayroll(
        @Body('month') month: string,
        @Body('year') year: string,
        @Body('generatedBy') generatedBy: string,
        @Body('details') details: any[],
    ) {
        return this.payrollService.confirmPayroll({ month, year, generatedBy, details });
    }

    @Get()
    async getAllPayrolls(@Query('year') year?: string) {
        // Basic listing, can be expanded
        // We can use prisma to findMany
        // For now, let's just return a placeholder or implement a findAll in service
        // But the user asked for generation logic specifically.
        // I'll stick to the core task logic first.
        return { message: "Use /generate to create payroll" };
    }

    @Get(':id')
    async getPayrollDetails(@Param('id') id: string) {
        return this.payrollService.getPayrollById(id);
    }
}
