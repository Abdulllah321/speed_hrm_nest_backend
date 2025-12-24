import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { LoanRequestService } from './loan-request.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateLoanRequestDto, UpdateLoanRequestDto, ApproveLoanRequestDto } from './dto/create-loan-request.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody, ApiQuery } from '@nestjs/swagger';

@ApiTags('Loan Request')
@Controller('api')
export class LoanRequestController {
  constructor(private service: LoanRequestService) {}

  @Get('loan-requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List loan requests' })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'loanTypeId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'approvalStatus', required: false })
  @ApiQuery({ name: 'requestedDate', required: false })
  @ApiQuery({ name: 'repaymentStartMonthYear', required: false })
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
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get loan request by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('loan-requests')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create loan request' })
  async create(@Body() body: CreateLoanRequestDto, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('loan-requests/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update loan request' })
  async update(@Param('id') id: string, @Body() body: UpdateLoanRequestDto, @Req() req) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('loan-requests/:id/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve loan request' })
  async approve(@Param('id') id: string, @Body() body: ApproveLoanRequestDto, @Req() req) {
    return this.service.approve(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('loan-requests/:id/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject loan request' })
  async reject(@Param('id') id: string, @Body() body: ApproveLoanRequestDto, @Req() req) {
    return this.service.reject(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('loan-requests/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete loan request' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
