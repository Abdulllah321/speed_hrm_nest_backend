import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { GrnService } from './grn.service';
import { CreateGrnDto } from './dto/grn.dto';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Goods Receipt Note')
@Controller('api/grn')
export class GrnController {
    constructor(private readonly grnService: GrnService) { }

    @Post()
    @ApiOperation({ summary: 'Create a new GRN and update stock' })
    create(@Body() createDto: CreateGrnDto) {
        return this.grnService.create(createDto);
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
