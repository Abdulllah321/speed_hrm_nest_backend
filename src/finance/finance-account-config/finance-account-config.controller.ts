import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { FinanceAccountConfigService } from './finance-account-config.service';
import {
  AccountRoleKey,
  BulkUpsertFinanceAccountConfigDto,
  UpsertFinanceAccountConfigDto,
} from './dto/finance-account-config.dto';

@ApiTags('Finance Account Configuration')
@Controller('api/finance/account-config')
export class FinanceAccountConfigController {
  constructor(private readonly service: FinanceAccountConfigService) {}

  @Get()
  @UseGuards(JwtAuthGuard, PermissionGuard('erp.finance.account-config.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all finance account role mappings' })
  findAll() {
    return this.service.findAll();
  }

  @Post()
  @UseGuards(JwtAuthGuard, PermissionGuard('erp.finance.account-config.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create or update a single account role mapping' })
  upsert(@Body() dto: UpsertFinanceAccountConfigDto) {
    return this.service.upsert(dto);
  }

  @Post('bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('erp.finance.account-config.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Bulk save all account role mappings' })
  bulkUpsert(@Body() dto: BulkUpsertFinanceAccountConfigDto) {
    return this.service.bulkUpsert(dto.configs);
  }

  @Delete(':key')
  @UseGuards(JwtAuthGuard, PermissionGuard('erp.finance.account-config.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Remove an account role mapping' })
  remove(@Param('key') key: AccountRoleKey) {
    return this.service.remove(key);
  }
}
