import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { LoanRequestService } from './loan-request.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateLoanRequestDto, UpdateLoanRequestDto, ApproveLoanRequestDto } from './dto/create-loan-request.dto';

@Controller('api')
export class LoanRequestController {
  constructor(private service: LoanRequestService) {}

  @Get('loan-requests')
  @UseGuards(JwtAuthGuard)
  async list(
    @Query('employeeId') employeeId?: string,
    @Query('loanTypeId') loanTypeId?: string,
    @Query('status') status?: string,
    @Query('approvalStatus') approvalStatus?: string,
    @Query('requestedDate') requestedDate?: string,
    @Query('repaymentStartMonthYear') repaymentStartMonthYear?: string,
  ) {
    return this.service.list({
      employeeId,
      loanTypeId,
      status,
      approvalStatus,
      requestedDate,
      repaymentStartMonthYear,
    });
  }

  @Get('loan-requests/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('loan-requests')
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: CreateLoanRequestDto, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('loan-requests/:id')
  @UseGuards(JwtAuthGuard)
  async update(@Param('id') id: string, @Body() body: UpdateLoanRequestDto, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('loan-requests/:id/approve')
  @UseGuards(JwtAuthGuard)
  async approve(@Param('id') id: string, @Body() body: ApproveLoanRequestDto, @Req() req) {
    return this.service.approve(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('loan-requests/:id/reject')
  @UseGuards(JwtAuthGuard)
  async reject(@Param('id') id: string, @Body() body: ApproveLoanRequestDto, @Req() req) {
    return this.service.reject(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('loan-requests/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
