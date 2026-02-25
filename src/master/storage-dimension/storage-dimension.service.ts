import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { PrismaService } from '../../database/prisma.service';

import {
  CreateStorageDimensionDto,
  UpdateStorageDimensionDto,
} from './dto/storage-dimension-dto';

@Injectable()
export class StorageDimensionService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateStorageDimensionDto, userId: string) {
    const result = await this.prisma.storageDimension.create({
      data: {
        ...createDto,
        createdById: userId,
      },
    });
    return {
      status: true,
      data: result,
      message: 'Storage Dimension created successfully',
    };
  }

  async findAll() {
    const data = await this.prisma.storageDimension.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data };
  }

  async findOne(id: string) {
    const storageDimension =
      await this.prisma.storageDimension.findUnique({
        where: { id },
      });
    if (!storageDimension) {
      throw new NotFoundException(`Storage Dimension with ID ${id} not found`);
    }
    return { status: true, data: storageDimension };
  }

  async update(id: string, updateDto: UpdateStorageDimensionDto) {
    const result = await this.prisma.storageDimension.update({
      where: { id },
      data: updateDto,
    });
    return {
      status: true,
      data: result,
      message: 'Storage Dimension updated successfully',
    };
  }

  async remove(id: string) {
    await this.prisma.storageDimension.delete({
      where: { id },
    });
    return { status: true, message: 'Storage Dimension deleted successfully' };
  }
}
