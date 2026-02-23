import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  Req,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { PosService } from './pos.service';
import { CreatePosDto } from './dto/create-pos.dto';
import { UpdatePosDto } from './dto/update-pos.dto';

@ApiTags('POS')
@Controller('api/pos')
@ApiBearerAuth()
export class PosController {
  constructor(private readonly posService: PosService) {}

  @Get()
  @ApiOperation({ summary: 'List all POS' })
  async list(@Query('locationId') locationId?: string) {
    return this.posService.list(locationId);
  }

    @Get('location/:locationId')
    @ApiOperation({ summary: 'List POS by location' })
    async listByLocation(@Param('locationId') locationId: string) {
        return this.posService.list(locationId);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get POS by ID' })
    async get(@Param('id') id: string) {
        return this.posService.get(id);
    }

  @Post()
  @ApiOperation({ summary: 'Create a new POS' })
  async create(@Body() body: CreatePosDto, @Req() req: any) {
    const ctx = {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
    return this.posService.create(body, ctx);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update an existing POS' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdatePosDto,
    @Req() req: any,
  ) {
    const ctx = {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
    return this.posService.update(id, body, ctx);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a POS' })
  async remove(@Param('id') id: string, @Req() req: any) {
    const ctx = {
      userId: req.user?.id,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };
    return this.posService.remove(id, ctx);
  }
}
