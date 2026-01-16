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
import { ExitClearanceService } from './exit-clearance.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  CreateExitClearanceDto,
  UpdateExitClearanceDto,
} from './dto/create-exit-clearance.dto';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';

@ApiTags('Exit Clearance')
@Controller('api')
export class ExitClearanceController {
  constructor(private service: ExitClearanceService) {}

  @Get('exit-clearances')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List exit clearances' })
  async list() {
    return this.service.list();
  }

  @Get('exit-clearances/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get exit clearance by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('exit-clearances')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create exit clearance' })
  async create(@Body() body: CreateExitClearanceDto, @Req() req: any) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('exit-clearances/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update exit clearance' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateExitClearanceDto,
    @Req() req: any,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('exit-clearances/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete exit clearance' })
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
