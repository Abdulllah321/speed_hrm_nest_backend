
import { Controller, Get, Post, Body, Patch, Param, Delete, Query } from '@nestjs/common';
import { PurchaseRequisitionService } from './purchase-requisition.service';
import { CreatePurchaseRequisitionDto } from './dto/create-purchase-requisition.dto';
import { UpdatePurchaseRequisitionDto } from './dto/update-purchase-requisition.dto';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';

@ApiTags('Purchase Requisition')
@Controller('api/purchase-requisition')
export class PurchaseRequisitionController {
    constructor(private readonly service: PurchaseRequisitionService) { }

    @Post()
    @ApiOperation({ summary: 'Create a new purchase requisition (DRAFT)' })
    create(@Body() createDto: CreatePurchaseRequisitionDto) {
        return this.service.create(createDto);
    }

    @Get()
    @ApiOperation({ summary: 'List all purchase requisitions' })
    @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
    findAll(@Query('status') status?: string) {
        return this.service.findAll(status);
    }

    @Get(':id')
    @ApiOperation({ summary: 'Get a specific purchase requisition' })
    findOne(@Param('id') id: string) {
        return this.service.findOne(id);
    }

    @Patch(':id')
    @ApiOperation({ summary: 'Update a purchase requisition or change status' })
    update(@Param('id') id: string, @Body() updateDto: UpdatePurchaseRequisitionDto) {
        return this.service.update(id, updateDto);
    }

    @Delete(':id')
    @ApiOperation({ summary: 'Delete a DRAFT purchase requisition' })
    remove(@Param('id') id: string) {
        return this.service.remove(id);
    }
}
