import { Controller, Get, Post, Body, Param, Logger } from '@nestjs/common';
import { GrnService } from './grn.service';
import { CreateGrnDto } from './dto/grn.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Goods Receipt Note')
@Controller('api/grn')
export class GrnController {
  private readonly logger = new Logger(GrnController.name);

  constructor(private readonly grnService: GrnService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new GRN and update stock' })
  async create(@Body() createDto: CreateGrnDto) {
    this.logger.log(`GRN creation request received`);
    this.logger.debug(`Request payload: ${JSON.stringify(createDto)}`);
    
    try {
      const result = await this.grnService.create(createDto);
      this.logger.log(`GRN creation successful: ${result.id}`);
      return result;
    } catch (error) {
      this.logger.error(`GRN creation failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  @Get()
  @ApiOperation({ summary: 'Get all GRNs' })
  findAll() {
    return this.grnService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get GRN by ID' })
  findOne(@Param('id') id: string) {
    return this.grnService.findOne(id);
  }
}
