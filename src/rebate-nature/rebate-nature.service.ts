import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRebateNatureDto } from './dto/create-rebate-nature.dto';
import { UpdateRebateNatureDto } from './dto/update-rebate-nature.dto';

@Injectable()
export class RebateNatureService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createRebateNatureDto: CreateRebateNatureDto, userId: string) {
    return this.prisma.rebateNature.create({
      data: {
        ...createRebateNatureDto,
        createdById: userId,
      },
      include: {
        createdBy: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }

  async findAll() {
    return this.prisma.rebateNature.findMany({
      include: {
        createdBy: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  async findFixedRebateNatures() {
    const fixedNatures = await this.prisma.rebateNature.findMany({
      where: {
        type: 'fixed',
        status: 'active',
      },
      orderBy: [
        { category: 'asc' },
        { name: 'asc' },
      ],
    });

    // Group by category
    const grouped = fixedNatures.reduce((acc, nature) => {
      const category = nature.category || 'Other';
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push(nature);
      return acc;
    }, {} as Record<string, typeof fixedNatures>);

    return grouped;
  }

  async findAllByType(type: 'fixed' | 'other') {
    return this.prisma.rebateNature.findMany({
      where: {
        type,
        status: 'active',
      },
      include: {
        createdBy: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: [
        { category: 'asc' },
        { name: 'asc' },
      ],
    });
  }

  async findOne(id: string) {
    const rebateNature = await this.prisma.rebateNature.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });

    if (!rebateNature) {
      throw new NotFoundException(`RebateNature with ID ${id} not found`);
    }

    return rebateNature;
  }

  async update(id: string, updateRebateNatureDto: UpdateRebateNatureDto) {
    await this.findOne(id); // Ensure exists

    return this.prisma.rebateNature.update({
      where: { id },
      data: updateRebateNatureDto,
      include: {
        createdBy: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id); // Ensure exists

    try {
      return await this.prisma.rebateNature.delete({
        where: { id },
      });
    } catch (error) {
      // Handle foreign key constraint errors if needed (though Restrict in schema handles it by throwing)
      throw error;
    }
  }
}
