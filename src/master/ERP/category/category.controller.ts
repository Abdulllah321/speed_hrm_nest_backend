import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards } from '@nestjs/common';
import { CategoryService } from './category.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../../common/guards/permissions.guard';

@Controller('api/master/erp/category')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Post()
  @Permissions('erp.category.create', 'erp.sub-category.create')
  async create(@Body() createCategoryDto: CreateCategoryDto) {
    const result = await this.categoryService.create(createCategoryDto);
    return { status: true, data: result, message: 'Category created successfully' };
  }

  @Get()
  @Permissions('erp.category.read', 'erp.sub-category.read')
  async findAll(@Query('parentId') parentId?: string) {
    const result = await this.categoryService.findAll(parentId);
    return { status: true, data: result };
  }

  @Get('tree')
  @Permissions('erp.category.read', 'erp.sub-category.read')
  async findTree() {
    const result = await this.categoryService.findTree();
    return { status: true, data: result };
  }

  @Get(':id')
  @Permissions('erp.category.read', 'erp.sub-category.read')
  async findOne(@Param('id') id: string) {
    const result = await this.categoryService.findOne(id);
    return { status: true, data: result };
  }

  @Patch(':id')
  @Permissions('erp.category.update', 'erp.sub-category.update')
  async update(@Param('id') id: string, @Body() updateCategoryDto: UpdateCategoryDto) {
    const result = await this.categoryService.update(id, updateCategoryDto);
    return { status: true, data: result, message: 'Category updated successfully' };
  }

  @Delete(':id')
  @Permissions('erp.category.delete', 'erp.sub-category.delete')
  async remove(@Param('id') id: string) {
    const result = await this.categoryService.remove(id);
    return { status: true, data: result, message: 'Category deleted successfully' };
  }
}
