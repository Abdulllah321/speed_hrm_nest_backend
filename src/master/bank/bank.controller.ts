import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { BankService } from './bank.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import { CreateBankDto, UpdateBankDto } from './dto/bank.dto';

@ApiTags('Bank')
@Controller('api')
export class BankController {
  constructor(private service: BankService) {}

  @Get('banks')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.bank.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all banks' })
  async list() {
    return this.service.list();
  }

  @Get('banks/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.bank.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get bank by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('banks')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.bank.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create bank' })
  async create(@Body() body: CreateBankDto, @Req() req: any) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Post('banks/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.bank.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create banks in bulk' })
  @ApiBody({ type: CreateBankDto, isArray: true })
  async createBulk(
    @Body()
    body: {
      items: CreateBankDto[];
    },
    @Req() req: any,
  ) {
    return this.service.createBulk(body.items ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Put('banks/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.bank.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update bank' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateBankDto,
    @Req() req: any,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Delete('banks/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.bank.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete bank' })
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Put('banks/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.bank.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update banks in bulk' })
  @ApiBody({ type: UpdateBankDto, isArray: true })
  async updateBulk(
    @Body()
    body: {
      items: UpdateBankDto[];
    },
    @Req() req: any,
  ) {
    return this.service.updateBulk((body.items as any) ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Delete('banks/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.bank.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete banks in bulk' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          example: ['uuid1', 'uuid2'],
        },
      },
    },
  })
  async removeBulk(@Body() body: { ids: string[] }, @Req() req: any) {
    return this.service.removeBulk(body.ids ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }
}
