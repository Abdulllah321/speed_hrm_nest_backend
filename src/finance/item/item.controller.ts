import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
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
  async findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: string,
  ) {
    return this.itemService.findAll(
      page ? Number(page) : 1,
      limit ? Number(limit) : 50,
      search,
      sortBy,
      sortOrder as 'asc' | 'desc' | undefined,
    );
  }

  @Get('hs-codes/unique')
  @Permissions('erp.item.read')
  @ApiOperation({ summary: 'Get unique HS codes' })
  async getUniqueHsCodes() {
    return this.itemService.getUniqueHsCodes();
  }

  @Get('next-id')
  @Permissions('erp.item.read')
  @ApiOperation({ summary: 'Get next auto-generated Item ID (preview)' })
  async nextId() {
    return this.itemService.nextItemId();
  }

  @Get('code/:code')
  @Permissions('erp.item.read')
  @ApiOperation({ summary: 'Get item by code (itemId)' })
  async findByCode(@Param('code') code: string) {
    return this.itemService.findByCode(code);
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
