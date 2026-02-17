import {
    Controller,
    Get,
    Post,
    Put,
    Delete,
    Body,
    Param,
    UseGuards,
    Req,
} from '@nestjs/common';
import { ItemService } from './item.service';
import { CreateItemDto, UpdateItemDto } from './dto/item.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('ERP Items')
@Controller('api/finance/items')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ItemController {
    constructor(private readonly itemService: ItemService) { }

    @Post()
    @Permissions('erp.item.create')
    @ApiOperation({ summary: 'Create new item' })
    async create(@Body() createItemDto: CreateItemDto) {
        return this.itemService.create(createItemDto);
    }

    @Get()
    @Permissions('erp.item.read')
    @ApiOperation({ summary: 'List all items' })
    async findAll() {
        return this.itemService.findAll();
    }

    @Get('next-id')
    @Permissions('erp.item.read')
    @ApiOperation({ summary: 'Get next auto-generated Item ID (preview)' })
    async nextId() {
        return this.itemService.nextItemId();
    }

    @Get(':id')
    @Permissions('erp.item.read')
    @ApiOperation({ summary: 'Get item by id' })
    async findOne(@Param('id') id: string) {
        return this.itemService.findOne(id);
    }

    @Put(':id')
    @Permissions('erp.item.update')
    @ApiOperation({ summary: 'Update item' })
    async update(@Param('id') id: string, @Body() updateItemDto: UpdateItemDto) {
        return this.itemService.update(id, updateItemDto);
    }

    @Delete(':id')
    @Permissions('erp.item.delete')
    @ApiOperation({ summary: 'Delete item' })
    async remove(@Param('id') id: string) {
        return this.itemService.remove(id);
    }
}
