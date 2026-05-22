import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { PrismaService } from '../../../database/prisma.service';

import { ActivityLogsService } from '../../../activity-logs/activity-logs.service';
import { runInBackground } from '../../../common/utils/run-in-background.util';
import { MasterDeleteGuardService } from '../../../common/services/master-delete-guard.service';

@Injectable()
export class CategoryService {
  constructor(
    private readonly masterDeleteGuard: MasterDeleteGuardService,
    private readonly prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async create(createCategoryDto: CreateCategoryDto) {
    if (createCategoryDto.parentId) {
      const parent = await this.prisma.category.findFirst({
        where: { id: createCategoryDto.parentId,
            isDeleted: false
        },
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
      where: { parentId: null,
          isDeleted: false
    },
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
    const category = await this.prisma.category.findFirst({
      where: { id,
          isDeleted: false
    },
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
    const category = await this.prisma.category.findFirst({
      where: { id, isDeleted: false },
    });

    if (!category) {
      throw new NotFoundException(`Category with ID ${id} not found`);
    }

    await this.masterDeleteGuard.assertCanDelete(this.prisma, 'category', id);

    return this.prisma.category.update({
      where: { id },
      data: { isDeleted: true, deletedAt: new Date() },
    });
  }
}
