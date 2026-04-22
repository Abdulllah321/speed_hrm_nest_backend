import { Controller, Get, Param, Query, UseGuards, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportsService } from './reports.service';

@ApiTags('Finance Reports')
@Controller('api/finance/reports')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /**
   * GET /api/finance/reports/trial-balance
   * Debit / Credit totals per leaf account.
   * Without date params → uses stored running balances (fast).
   * With date params   → aggregates AccountTransaction rows for the period.
   */
  @Get('trial-balance')
  @ApiOperation({ summary: 'Trial Balance' })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'ISO date (period start)' })
  @ApiQuery({ name: 'to',   required: false, type: String, description: 'ISO date (period end)' })
  async trialBalance(
    @Query('from') from?: string,
    @Query('to')   to?: string,
  ) {
    return { status: true, data: await this.reports.getTrialBalance(from, to) };
  }

  /**
   * GET /api/finance/reports/general-ledger/:accountId
   * Full transaction history for one account with opening & closing balance.
   */
  @Get('general-ledger/:accountId')
  @ApiOperation({ summary: 'General Ledger for a single account' })
  @ApiQuery({ name: 'from',  required: false, type: String })
  @ApiQuery({ name: 'to',    required: false, type: String })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  async generalLedger(
    @Param('accountId') accountId: string,
    @Query('from')  from?: string,
    @Query('to')    to?: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page  = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
  ) {
    return { status: true, data: await this.reports.getGeneralLedger(accountId, from, to, page, limit) };
  }

  /**
   * GET /api/finance/reports/income-statement
   * Profit & Loss — INCOME vs EXPENSE accounts for a period.
   */
  @Get('income-statement')
  @ApiOperation({ summary: 'Income Statement (Profit & Loss)' })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to',   required: false, type: String })
  async incomeStatement(
    @Query('from') from?: string,
    @Query('to')   to?: string,
  ) {
    return { status: true, data: await this.reports.getIncomeStatement(from, to) };
  }

  /**
   * GET /api/finance/reports/balance-sheet
   * ASSET / LIABILITY / EQUITY snapshot.
   * asOf defaults to current stored balances when omitted.
   */
  @Get('balance-sheet')
  @ApiOperation({ summary: 'Balance Sheet' })
  @ApiQuery({ name: 'asOf', required: false, type: String, description: 'ISO date snapshot' })
  async balanceSheet(@Query('asOf') asOf?: string) {
    return { status: true, data: await this.reports.getBalanceSheet(asOf) };
  }

  /**
   * GET /api/finance/reports/summary
   * Activity summary grouped by source type and account type.
   */
  @Get('summary')
  @ApiOperation({ summary: 'Account activity summary (dashboard)' })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to',   required: false, type: String })
  async summary(
    @Query('from') from?: string,
    @Query('to')   to?: string,
  ) {
    return { status: true, data: await this.reports.getAccountSummary(from, to) };
  }
}
