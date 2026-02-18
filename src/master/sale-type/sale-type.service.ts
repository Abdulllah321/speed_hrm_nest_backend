import { Injectable } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { CreateSaleTypeDto, UpdateSaleTypeDto } from './dto/sale-type-dto';

@Injectable()
export class SaleTypeService {
  constructor(private prisma: PrismaMasterService) {}

  async create(createDto: CreateSaleTypeDto, userId: string) {
    const result = await this.prisma.saleType.create({
      data: {
        ...createDto,
        createdById: userId,
      },
    });
    return {
      status: true,
      data: result,
      message: 'Sale Type created successfully',
    };
  }

  async findAll() {
    const data = await this.prisma.saleType.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data };
  }

  async findOne(id: string) {
    const data = await this.prisma.saleType.findUnique({
      where: { id },
    });
    return { status: true, data };
  }

  async update(id: string, updateDto: UpdateSaleTypeDto) {
    const result = await this.prisma.saleType.update({
      where: { id },
      data: updateDto,
    });
    return {
      status: true,
      data: result,
      message: 'Sale Type updated successfully',
    };
  }

  async remove(id: string) {
    await this.prisma.saleType.delete({
      where: { id },
    });
    return { status: true, message: 'Sale Type deleted successfully' };
  }
}
