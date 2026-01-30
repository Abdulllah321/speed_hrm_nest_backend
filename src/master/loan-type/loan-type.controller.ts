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
import { LoanTypeService } from './loan-type.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import {
  CreateLoanTypeDto,
  UpdateLoanTypeDto,
  BulkUpdateLoanTypeDto,
  BulkUpdateLoanTypeItemDto,
} from './dto/loan-type.dto';

@ApiTags('Loan Type')
@Controller('api')
export class LoanTypeController {
  constructor(private service: LoanTypeService) {}

  @Get('loan-types')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.loan-type.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all loan types' })
  async list() {
    return this.service.list();
  }

  @Get('loan-types/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.loan-type.read'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get loan type by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('loan-types')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.loan-type.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create loan type' })
  async create(@Body() body: CreateLoanTypeDto, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('loan-types/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.loan-type.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update loan type' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateLoanTypeDto,
    @Req() req,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('loan-types/:id')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.loan-type.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete loan type' })
  async remove(@Param('id') id: string, @Req() req) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('loan-types/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.loan-type.create'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create loan types in bulk' })
  @ApiBody({ type: CreateLoanTypeDto, isArray: true })
  async createBulk(@Body() body: { items: CreateLoanTypeDto[] }, @Req() req) {
    return this.service.createBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('loan-types/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.loan-type.update'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update loan types in bulk' })
  @ApiBody({ type: BulkUpdateLoanTypeDto })
  async updateBulk(@Body() body: BulkUpdateLoanTypeDto, @Req() req) {
    return this.service.updateBulk(body.items || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('loan-types/bulk')
  @UseGuards(JwtAuthGuard, PermissionGuard('master.loan-type.delete'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete loan types in bulk' })
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
  async removeBulk(@Body() body: { ids: string[] }, @Req() req) {
    return this.service.removeBulk(body.ids || [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
