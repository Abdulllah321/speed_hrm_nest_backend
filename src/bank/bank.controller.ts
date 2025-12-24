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
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

interface AuthenticatedRequest {
  user?: { userId?: string };
  ip?: string;
  headers?: { 'user-agent'?: string };
}

@Controller('api')
export class BankController {
  constructor(private service: BankService) {}

  @Get('banks')
  @UseGuards(JwtAuthGuard)
  async list() {
    return this.service.list();
  }

  @Get('banks/:id')
  @UseGuards(JwtAuthGuard)
  async get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Post('banks')
  @UseGuards(JwtAuthGuard)
  async create(
    @Body()
    body: {
      name: string;
      code?: string;
      accountNumberPrefix?: string;
      status?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.create(body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Post('banks/bulk')
  @UseGuards(JwtAuthGuard)
  async createBulk(
    @Body()
    body: {
      items: {
        name: string;
        code?: string;
        accountNumberPrefix?: string;
        status?: string;
      }[];
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.createBulk(body.items ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Put('banks/:id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      code?: string;
      accountNumberPrefix?: string;
      status?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.update(id, body, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Delete('banks/:id')
  @UseGuards(JwtAuthGuard)
  async remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.service.remove(id, {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Put('banks/bulk')
  @UseGuards(JwtAuthGuard)
  async updateBulk(
    @Body()
    body: {
      items: {
        id: string;
        name: string;
        code?: string;
        accountNumberPrefix?: string;
        status?: string;
      }[];
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.updateBulk(body.items ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }

  @Delete('banks/bulk')
  @UseGuards(JwtAuthGuard)
  async removeBulk(
    @Body() body: { ids: string[] },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.removeBulk(body.ids ?? [], {
      userId: req.user?.userId,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }
}

