import { Controller, Get, Post, Put, Delete, Param, Body, Req, UseGuards } from '@nestjs/common';
import { RequestForwardingService } from './request-forwarding.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateRequestForwardingDto } from './dto/create-request-forwarding.dto';
import { UpdateRequestForwardingDto } from './dto/update-request-forwarding.dto';

@Controller('api')
export class RequestForwardingController {
  constructor(private service: RequestForwardingService) {}

  @Get('request-forwarding')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list();
  }

  @Get('request-forwarding/:requestType')
  @UseGuards(JwtAuthGuard)
  async getByRequestType(@Param('requestType') requestType: string) {
    return this.service.getByRequestType(requestType);
  }

  @Post('request-forwarding')
  @UseGuards(JwtAuthGuard)
  async create(@Body() body: CreateRequestForwardingDto, @Req() req) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('request-forwarding/:requestType')
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard)
  async delete(@Param('requestType') requestType: string, @Req() req) {
    return this.service.delete(requestType, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
