import { Controller, Get, Post, Body, Param, Query, UseGuards, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportsService } from './reports.service';

@ApiTags('Finance Reports')
@Controller('api/finance/reports')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ReportsController {
  constructor(private readonly reports: ReportsService,) {}

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
  @ApiQuery({ name: 'includeTagAccounts', required: false, type: Boolean })
  async trialBalance(
    @Query('from') from?: string,
    @Query('to')   to?: string,
    @Query('includeTagAccounts') includeTagAccounts?: string,
  ) {
    const includeTags = includeTagAccounts === 'true';
    return { status: true, data: await this.reports.getTrialBalance(from, to, includeTags) };
  }

  /**
   * GET /api/finance/reports/general-ledger/:accountId
   * Full transaction history for one or multiple accounts with opening & closing balance.
   */
  @Get('general-ledger/:accountId')
  @ApiOperation({ summary: 'General Ledger for single or multiple accounts' })
  @ApiQuery({ name: 'from',  required: false, type: String })
  @ApiQuery({ name: 'to',    required: false, type: String })
  @ApiQuery({ name: 'page',  required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sourceType', required: false, type: String })
  @ApiQuery({ name: 'accountId', required: false, type: String })
  async generalLedger(
    @Param('accountId') accountId: string,
    @Query('from')  from?: string,
    @Query('to')    to?: string,
    @Query('page',  new DefaultValuePipe(1),  ParseIntPipe) page  = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
    @Query('sourceType') sourceType?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
    @Query('accountId') queryAccountId?: string,
  ) {
    const effectiveId = queryAccountId || accountId;
    return { status: true, data: await this.reports.getGeneralLedger(effectiveId, from, to, page, limit, sourceType, sortBy, sortOrder) };
  }

  @Get('general-ledger')
  @ApiOperation({ summary: 'General Ledger for multiple accounts via query parameter' })
  @ApiQuery({ name: 'accountId', required: true, type: String })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sourceType', required: false, type: String })
  async generalLedgerQuery(
    @Query('accountId') accountId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit = 50,
    @Query('sourceType') sourceType?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
    return { status: true, data: await this.reports.getGeneralLedger(accountId, from, to, page, limit, sourceType, sortBy, sortOrder) };
  }

  /**
   * GET /api/finance/reports/income-statement
   * Profit & Loss — INCOME vs EXPENSE accounts for a period with comparison & tag breakdown.
   */
  @Get('income-statement')
  @ApiOperation({ summary: 'Income Statement (Profit & Loss)' })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  @ApiQuery({ name: 'compareFrom', required: false, type: String })
  @ApiQuery({ name: 'compareTo', required: false, type: String })
  @ApiQuery({ name: 'includeTagAccounts', required: false, type: Boolean })
  @ApiQuery({ name: 'showZeroBalances', required: false, type: Boolean })
  async incomeStatement(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('compareFrom') compareFrom?: string,
    @Query('compareTo') compareTo?: string,
    @Query('includeTagAccounts') includeTagAccounts?: string,
    @Query('showZeroBalances') showZeroBalances?: string,
  ) {
    const isIncludeTags = includeTagAccounts !== undefined ? includeTagAccounts === 'true' : true;
    const isShowZero = showZeroBalances === 'true';
    return {
      status: true,
      data: await this.reports.getIncomeStatement({
        from,
        to,
        compareFrom,
        compareTo,
        includeTagAccounts: isIncludeTags,
        showZeroBalances: isShowZero,
      }),
    };
  }

  /**
   * GET /api/finance/reports/balance-sheet
   * ASSET / LIABILITY / EQUITY snapshot.
   * asOf defaults to current stored balances when omitted.
   */
  @Get('balance-sheet')
  @ApiOperation({ summary: 'Balance Sheet' })
  @ApiQuery({ name: 'asOf', required: false, type: String, description: 'ISO date snapshot' })
  @ApiQuery({ name: 'compareAsOf', required: false, type: String, description: 'Comparative ISO date snapshot' })
  @ApiQuery({ name: 'includeTagAccounts', required: false, type: Boolean })
  @ApiQuery({ name: 'showZeroBalances', required: false, type: Boolean })
  async balanceSheet(
    @Query('asOf') asOf?: string,
    @Query('compareAsOf') compareAsOf?: string,
    @Query('includeTagAccounts') includeTagAccounts?: string,
    @Query('showZeroBalances') showZeroBalances?: string,
  ) {
    return {
      status: true,
      data: await this.reports.getBalanceSheet({
        asOf,
        compareAsOf,
        includeTagAccounts: includeTagAccounts === 'true' || includeTagAccounts === undefined,
        showZeroBalances: showZeroBalances === 'true',
      }),
    };
  }

  /**
   * GET /api/finance/reports/general-ledger-summary
   * Sub-account summary for a parent account and selected child account IDs.
   */
  @Get('general-ledger-summary')
  @ApiOperation({ summary: 'General Ledger Subaccount Summary Report' })
  @ApiQuery({ name: 'parentAccountIds', required: true, type: String, description: 'Comma-separated parent account IDs' })
  @ApiQuery({ name: 'subAccountIds', required: false, type: String, description: 'Comma-separated sub-account IDs (optional)' })
  @ApiQuery({ name: 'from', required: false, type: String })
  @ApiQuery({ name: 'to', required: false, type: String })
  async generalLedgerSummary(
    @Query('parentAccountIds') parentAccountIds: string,
    @Query('subAccountIds') subAccountIds?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const parentIds = parentAccountIds && parentAccountIds.trim() !== '' ? parentAccountIds.split(',') : [];
    const ids = subAccountIds && subAccountIds.trim() !== '' ? subAccountIds.split(',') : [];
    return {
      status: true,
      data: await this.reports.getSubaccountSummary(parentIds, ids, from, to),
    };
  }

  /**
   * POST /api/finance/reports/general-ledger-summary
   * Sub-account summary accepting large list of parent and sub-account IDs in body.
   */
  @Post('general-ledger-summary')
  @ApiOperation({ summary: 'General Ledger Subaccount Summary Report (POST)' })
  async generalLedgerSummaryPost(
    @Body()
    body: {
      parentAccountIds: string[] | string;
      subAccountIds?: string[] | string;
      from?: string;
      to?: string;
    },
  ) {
    let parentIds: string[] = [];
    if (Array.isArray(body?.parentAccountIds)) {
      parentIds = body.parentAccountIds;
    } else if (typeof body?.parentAccountIds === 'string' && body.parentAccountIds.trim() !== '') {
      parentIds = body.parentAccountIds.split(',');
    }

    let ids: string[] = [];
    if (Array.isArray(body?.subAccountIds)) {
      ids = body.subAccountIds;
    } else if (typeof body?.subAccountIds === 'string' && body.subAccountIds.trim() !== '') {
      ids = body.subAccountIds.split(',');
    }

    return {
      status: true,
      data: await this.reports.getSubaccountSummary(parentIds, ids, body?.from, body?.to),
    };
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
