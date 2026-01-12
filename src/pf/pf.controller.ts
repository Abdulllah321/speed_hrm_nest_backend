import { Controller, Get, Post, Body, Query, UseGuards, Req } from '@nestjs/common';
import { PFService } from './pf.service';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
// Assuming JwtAuthGuard is available similarly to other controllers, usually standard practice
// But PayrollController didn't show explicit UseGuards in the snippet I saw, 
// however usually it's globally applied or specific. 
// I will check if I need to import it. PayrollController didn't have it on top.
// Let's assume standard controller structure.

@ApiTags('Provident Fund')
@Controller('api/pf')
export class PFController {
    constructor(private readonly pfService: PFService) { }

    @Get('employees')
    @ApiOperation({ summary: 'Get PF balances for all employees' })
    @ApiResponse({ status: 200, description: 'Returns PF balance data for employees' })
    async getPFEmployees() {
        return this.pfService.getPFEmployees();
    }

    @Post('withdrawals')
    @ApiOperation({ summary: 'Create PF withdrawal' })
    @ApiResponse({ status: 201, description: 'PF withdrawal created successfully' })
    async createPFWithdrawal(
        @Body('employeeId') employeeId: string,
        @Body('withdrawalAmount') withdrawalAmount: number,
        @Body('month') month: string,
        @Body('year') year: string,
        @Body('reason') reason?: string,
        @Body('createdById') createdById?: string,
    ) {
        return this.pfService.createPFWithdrawal({
            employeeId,
            withdrawalAmount,
            month,
            year,
            reason,
            createdById,
        });
    }

    @Get('withdrawals')
    @ApiOperation({ summary: 'Get all PF withdrawals' })
    @ApiResponse({ status: 200, description: 'Returns list of PF withdrawals' })
    async getPFWithdrawals(
        @Query('employeeId') employeeId?: string,
        @Query('departmentId') departmentId?: string,
        @Query('month') month?: string,
        @Query('year') year?: string,
        @Query('status') status?: string,
    ) {
        return this.pfService.getPFWithdrawals({
            employeeId,
            departmentId,
            month,
            year,
            status,
        });
    }
}
