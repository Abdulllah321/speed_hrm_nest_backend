import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { RfqService } from './rfq.service';
import { CreateRfqDto } from './dto/create-rfq.dto';
import { UpdateRfqDto, AddVendorsDto } from './dto/update-rfq.dto';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';

@ApiTags('Request For Quotation (RFQ)')
@Controller('rfq')
export class RfqController {
    constructor(private readonly service: RfqService) { }

    @Post()
    @ApiOperation({ summary: 'Create RFQ from APPROVED Purchase Requisition' })
    create(@Body() createDto: CreateRfqDto) {
        return this.service.create(createDto);
    }

    @Get()
    @ApiOperation({ summary: 'List all RFQs' })
    @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
    findAll(@Query('status') status?: string) {
        return this.service.findAll(status);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get RFQ details with PR items and vendors' })
    findOne(@Param('id') id: string) {
        return this.service.findOne(id);
    }

    @Post(':id/vendors')
    @ApiOperation({ summary: 'Add vendors to DRAFT RFQ' })
    addVendors(@Param('id') id: string, @Body() addVendorsDto: AddVendorsDto) {
        return this.service.addVendors(id, addVendorsDto);
    }

    @Post(':id/send')
    @ApiOperation({ summary: 'Mark RFQ as SENT' })
    markAsSent(@Param('id') id: string) {
        return this.service.markAsSent(id);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Update RFQ' })
    update(@Param('id') id: string, @Body() updateDto: UpdateRfqDto) {
        return this.service.update(id, updateDto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete DRAFT RFQ' })
    remove(@Param('id') id: string) {
        return this.service.remove(id);
    }
}
