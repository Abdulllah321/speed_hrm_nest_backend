import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ItemService } from './item.service';
import { CreateItemDto, UpdateItemDto, BulkDiscountDto, RollbackCampaignDto, BulkSalePriceDto, BulkSearchIdsDto } from './dto/item.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

@ApiTags('ERP Items')
@Controller('api/finance/items')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@ApiBearerAuth()
export class ItemController {
  constructor(private readonly itemService: ItemService) {}

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
    @Query('brandIds') brandIds?: string,
    @Query('categoryIds') categoryIds?: string,
    @Query('silhouetteIds') silhouetteIds?: string,
    @Query('genderIds') genderIds?: string,
  ) {
    const parseIds = (v?: string) => (v ? v.split(',').filter(Boolean) : undefined);
    return this.itemService.findAll(
      page ? Number(page) : 1,
      limit ? Number(limit) : 50,
      search,
      sortBy,
      sortOrder as 'asc' | 'desc' | undefined,
      {
        brandIds: parseIds(brandIds),
        categoryIds: parseIds(categoryIds),
        silhouetteIds: parseIds(silhouetteIds),
        genderIds: parseIds(genderIds),
      },
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

  // ── Discount Campaigns ──────────────────────────────────────────────────────

  @Patch('bulk-discount')
  @Permissions('erp.item.update')
  @ApiOperation({ summary: 'Apply or clear discount on multiple items — persists a DiscountCampaign record' })
  async bulkDiscount(@Body() dto: BulkDiscountDto) {
    return this.itemService.bulkDiscount(dto);
  }

  @Patch('bulk-sale-price')
  @Permissions('erp.item.update')
  @ApiOperation({ summary: 'Update unit price on multiple items in bulk' })
  async bulkSalePrice(@Body() dto: BulkSalePriceDto) {
    return this.itemService.bulkSalePrice(dto);
  }

  @Get('campaigns')
  @Permissions('erp.item.read')
  @ApiOperation({ summary: 'List all discount campaigns (paginated, newest first)' })
  async getCampaigns(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.itemService.getCampaigns(
      page ? Number(page) : 1,
      limit ? Number(limit) : 20,
    );
  }

  @Get('campaigns/:id')
  @Permissions('erp.item.read')
  @ApiOperation({ summary: 'Get a single campaign with all its items' })
  async getCampaign(@Param('id') id: string) {
    return this.itemService.getCampaign(id);
  }

  @Post('campaigns/rollback')
  @Permissions('erp.item.update')
  @ApiOperation({ summary: 'Rollback a campaign — restores pre-apply discount state from DB snapshot' })
  async rollbackCampaign(@Body() dto: RollbackCampaignDto) {
    return this.itemService.rollbackCampaign(dto);
  }

  @Post('bulk-search')
  @Permissions('erp.item.read')
  @ApiOperation({ summary: 'Bulk search items by an array of barcodes, SKUs, or Item IDs' })
  async bulkSearchByBarcodes(@Body() dto: BulkSearchIdsDto) {
    return this.itemService.bulkSearchByBarcodes(dto.barcodes);
  }

  // ── Standard CRUD ───────────────────────────────────────────────────────────

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

  // DISABLED: Items cannot be deleted to maintain data integrity
  // @Delete(':id')
  // @Permissions('erp.item.delete')
  // @ApiOperation({ summary: 'Delete item' })
  // async remove(@Param('id') id: string) {
  //   return this.itemService.remove(id);
  // }
}
