import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { LeaveEncashmentService } from './leave-encashment.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CreateLeaveEncashmentDto,
  UpdateLeaveEncashmentDto,
  ApproveLeaveEncashmentDto,
} from './dto/leave-encashment.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
  ApiQuery,
} from '@nestjs/swagger';

@ApiTags('Leave Encashment')
@Controller('api')
export class LeaveEncashmentController {
  constructor(private service: LeaveEncashmentService) {}

  @Get('leave-encashments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List leave encashments' })
  @ApiQuery({ name: 'employeeId', required: false })
  @ApiQuery({ name: 'paymentMonth', required: false })
  @ApiQuery({ name: 'paymentYear', required: false })
  @ApiQuery({ name: 'paymentMonthYear', required: false })
  @ApiQuery({ name: 'approvalStatus', required: false })
  @ApiQuery({ name: 'status', required: false })
  async list(
    @Query('employeeId') employeeId?: string,
    @Query('paymentMonth') paymentMonth?: string,
    @Query('paymentYear') paymentYear?: string,
    @Query('paymentMonthYear') paymentMonthYear?: string,
    @Query('approvalStatus') approvalStatus?: string,
    @Query('status') status?: string,
  ) {
    return this.service.list({
      employeeId,
      paymentMonth,
      paymentYear,
      paymentMonthYear,
      approvalStatus,
      status,
    });
  }

  @Get('leave-encashments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get leave encashment by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('leave-encashments')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create leave encashment request' })
  async create(@Body() body: CreateLeaveEncashmentDto, @Req() req) {
    // Extract userId from JWT token (could be 'sub', 'id', or 'userId')
    const user = req.user as any;
    const userId = user?.userId || user?.sub || user?.id || null;

    return this.service.create(body, {
      userId: userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('leave-encashments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update leave encashment request' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateLeaveEncashmentDto,
    @Req() req,
  ) {
    // Extract userId from JWT token (could be 'sub', 'id', or 'userId')
    const user = req.user as any;
    const userId = user?.userId || user?.sub || user?.id || null;

    return this.service.update(id, body, {
      userId: userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('leave-encashments/:id/approve')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve leave encashment request' })
  async approve(
    @Param('id') id: string,
    @Body() body: ApproveLeaveEncashmentDto,
    @Req() req,
  ) {
    // Extract userId from JWT token (could be 'sub', 'id', or 'userId')
    const user = req.user as any;
    const userId = user?.userId || user?.sub || user?.id || null;

    return this.service.approve(id, body, {
      userId: userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Post('leave-encashments/:id/reject')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reject leave encashment request' })
  async reject(
    @Param('id') id: string,
    @Body() body: ApproveLeaveEncashmentDto,
    @Req() req,
  ) {
    // Extract userId from JWT token (could be 'sub', 'id', or 'userId')
    const user = req.user as any;
    const userId = user?.userId || user?.sub || user?.id || null;

    return this.service.reject(id, body, {
      userId: userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('leave-encashments/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete leave encashment request' })
  async remove(@Param('id') id: string, @Req() req) {
    // Extract userId from JWT token (could be 'sub', 'id', or 'userId')
    const user = req.user as any;
    const userId = user?.userId || user?.sub || user?.id || null;

    return this.service.remove(id, {
      userId: userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
