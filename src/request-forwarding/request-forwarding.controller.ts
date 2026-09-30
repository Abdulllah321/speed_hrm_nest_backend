import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Req,
  UseGuards,
} from '@nestjs/common';
import { RequestForwardingService } from './request-forwarding.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { CreateRequestForwardingDto } from './dto/create-request-forwarding.dto';
import { UpdateRequestForwardingDto } from './dto/update-request-forwarding.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';

@ApiTags('Request Forwarding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('api')
export class RequestForwardingController {
  constructor(private service: RequestForwardingService) {}

  @Get('request-forwarding')
  @Permissions('hr.request-forwarding.view')
  @ApiOperation({ summary: 'List request forwarding configurations' })
  async list() {
    return this.service.list();
  }

  @Get('request-forwarding/:requestType')
  @Permissions('hr.request-forwarding.view')
  @ApiOperation({
    summary: 'Get request forwarding configuration by request type',
  })
  async getByRequestType(@Param('requestType') requestType: string) {
    return this.service.getByRequestType(requestType);
  }

  @Post('request-forwarding')
  @Permissions('hr.request-forwarding.manage')
  @ApiOperation({ summary: 'Create request forwarding configuration' })
  async create(@Body() body: CreateRequestForwardingDto, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('request-forwarding/:requestType')
  @Permissions('hr.request-forwarding.manage')
  @ApiOperation({ summary: 'Update request forwarding configuration' })
  async update(
    @Param('requestType') requestType: string,
    @Body() body: UpdateRequestForwardingDto,
    @Req() req,
  ) {
    return this.service.update(requestType, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('request-forwarding/:requestType')
  @Permissions('hr.request-forwarding.manage')
  @ApiOperation({ summary: 'Delete request forwarding configuration' })
  async delete(@Param('requestType') requestType: string, @Req() req) {
    return this.service.delete(requestType, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
