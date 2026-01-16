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
import { SalaryBreakupService } from './salary-breakup.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import {
  CreateSalaryBreakupDto,
  UpdateSalaryBreakupDto,
} from './dto/salary-breakup.dto';

@ApiTags('Salary Breakup')
@Controller('api')
export class SalaryBreakupController {
  constructor(private service: SalaryBreakupService) {}

  @Get('salary-breakups')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all salary breakups' })
  async list() {
    return this.service.list();
  }

  @Get('salary-breakups/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get salary breakup by id' })
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('salary-breakups')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create salary breakup' })
  async create(@Body() body: CreateSalaryBreakupDto, @Req() req: any) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Put('salary-breakups/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update salary breakup' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateSalaryBreakupDto,
    @Req() req: any,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  @Delete('salary-breakups/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete salary breakup' })
  async remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
