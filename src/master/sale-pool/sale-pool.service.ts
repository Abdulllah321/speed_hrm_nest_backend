import { Injectable } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { CreateSalePoolDto, UpdateSalePoolDto } from './dto/sale-pool-dto';

@Injectable()
export class SalePoolService {
  constructor(private prisma: PrismaMasterService) { }

  async create(createDto: CreateSalePoolDto, userId: string) {
    const result = await this.prisma.salePool.create({
      data: {
        ...createDto,
        createdById: userId,
      },
    });
    return { status: true, data: result, message: 'Sale Pool created successfully' };
  }

  async findAll() {
    const data = await this.prisma.salePool.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data };
  }

  async findOne(id: string) {
    const data = await this.prisma.salePool.findUnique({
      where: { id },
    });
    return { status: true, data };
  }

  async update(id: string, updateDto: UpdateSalePoolDto) {
    const result = await this.prisma.salePool.update({
      where: { id },
      data: updateDto,
    });
    return { status: true, data: result, message: 'Sale Pool updated successfully' };
  }

  async remove(id: string) {
    await this.prisma.salePool.delete({
      where: { id },
    });
    return { status: true, message: 'Sale Pool deleted successfully' };
  }
}
