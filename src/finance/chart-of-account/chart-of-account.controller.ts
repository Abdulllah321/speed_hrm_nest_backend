import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ChartOfAccountService } from './chart-of-account.service';
import {
  CreateChartOfAccountDto,
  UpdateChartOfAccountDto,
} from './dto/chart-of-account.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Chart of Accounts')
@Controller('api/finance/chart-of-accounts')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChartOfAccountController {
  constructor(private readonly chartOfAccountService: ChartOfAccountService) {}

  @Post()
  @ApiBearerAuth()
  @Permissions('erp.finance.chart-of-account.create')
  @ApiOperation({ summary: 'Create a new chart of account' })
  create(@Body() createDto: CreateChartOfAccountDto, @Req() req: any) {
    return this.chartOfAccountService.create(createDto, {
      userId: req.user?.userId,
    });
  }

  @Get()
  @ApiBearerAuth()
  @Permissions('erp.finance.chart-of-account.read')
  @ApiOperation({ summary: 'Get all chart of accounts' })
  findAll() {
    return this.chartOfAccountService.findAll();
  }

  @Get(':id')
  @ApiBearerAuth()
  @Permissions('erp.finance.chart-of-account.read')
  @ApiOperation({ summary: 'Get a chart of account by id' })
  findOne(@Param('id') id: string) {
    return this.chartOfAccountService.findOne(id);
  }

  @Put(':id')
  @ApiBearerAuth()
  @Permissions('erp.finance.chart-of-account.update')
  @ApiOperation({ summary: 'Update a chart of account' })
  update(
    @Param('id') id: string,
    @Body() updateDto: UpdateChartOfAccountDto,
    @Req() req: any,
  ) {
    return this.chartOfAccountService.update(id, updateDto, {
      userId: req.user?.userId,
    });
  }

  @Delete(':id')
  @ApiBearerAuth()
  @Permissions('erp.finance.chart-of-account.delete')
  @ApiOperation({ summary: 'Delete a chart of account' })
  remove(@Param('id') id: string) {
    return this.chartOfAccountService.remove(id);
  }
}
