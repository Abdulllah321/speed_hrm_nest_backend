import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class CategoryService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createCategoryDto: CreateCategoryDto) {
    if (createCategoryDto.parentId) {
      const parent = await this.prisma.category.findUnique({
        where: { id: createCategoryDto.parentId },
      });
      if (!parent) {
        throw new NotFoundException('Parent category not found');
      }
    }

    return this.prisma.category.create({
      data: createCategoryDto,
    });
  }

  async findAll(parentId?: string) {
    const where: any = {};
    if (parentId === 'sub') {
      where.parentId = { not: null };
    } else {
      where.parentId = parentId || null;
    }

    return this.prisma.category.findMany({
      where,
      include: {
        parent: true,
        _count: {
          select: { children: true },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findTree() {
    return this.prisma.category.findMany({
      where: { parentId: null },
      include: {
        children: {
          include: {
            children: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: {
        parent: true,
        children: true,
      },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    return category;
  }

  async update(id: string, updateCategoryDto: UpdateCategoryDto) {
    await this.findOne(id);

    if (updateCategoryDto.parentId === id) {
      throw new BadRequestException('A category cannot be its own parent');
    }

    return this.prisma.category.update({
      where: { id },
      data: updateCategoryDto,
    });
  }

  async remove(id: string) {
    const category = await this.prisma.category.findUnique({
      where: { id },
      include: { children: true },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    if (category.children.length > 0) {
      throw new BadRequestException(
        'Cannot delete category with sub-categories',
      );
    }

    return this.prisma.category.delete({
      where: { id },
    });
  }
}
