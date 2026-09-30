import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import { TransferService } from './transfer.service';
import { CreateTransferDto } from './dto/create-transfer.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

@ApiTags('Employee Transfer')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api')
export class TransferController {
  constructor(private readonly transferService: TransferService) {}

  @Post('employee-transfer')
  @Permissions('hr.employee.transfer')
  @ApiOperation({ summary: 'Transfer an employee' })
  create(@Body() createTransferDto: CreateTransferDto, @Req() req: any) {
    return this.transferService.create(createTransferDto, req.user.id);
  }

  @Get('employee-transfer/employee/:id')
  @Permissions('hr.employee.read')
  @ApiOperation({ summary: 'Get employee transfer history' })
  findAll(@Param('id') id: string) {
    return this.transferService.findAll(id);
  }
}
