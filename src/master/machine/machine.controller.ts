import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Delete,
  Put,
  UseGuards,
  Req,
  Logger,
} from '@nestjs/common';
import { MachineService } from './machine.service';
import { CreateMachineDto, UpdateMachineDto } from './dto/machine-dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('Machine')
@Controller('api/machines')
export class MachineController {
  private readonly logger = new Logger(MachineController.name);

  constructor(private readonly machineService: MachineService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create machine' })
  create(@Body() createDto: CreateMachineDto, @Req() req) {
    return this.machineService.create(createDto, req.user.userId);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List all machines' })
  findAll() {
    this.logger.log('Fetching all machines');
    return this.machineService.findAll();
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get machine by id' })
  findOne(@Param('id') id: string) {
    return this.machineService.findOne(id);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update machine' })
  update(@Param('id') id: string, @Body() updateDto: UpdateMachineDto) {
    return this.machineService.update(id, updateDto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Delete machine' })
  remove(@Param('id') id: string) {
    return this.machineService.remove(id);
  }
}
