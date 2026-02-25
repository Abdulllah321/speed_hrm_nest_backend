import { PrismaService } from '../../database/prisma.service';
import { Injectable } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { CreateSalesmanDto, UpdateSalesmanDto } from './dto/salesman-dto';

@Injectable()
export class SalesmanService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateSalesmanDto, userId: string) {
    const result = await this.prisma.salesman.create({
      data: {
        ...createDto,
        createdById: userId,
      },
    });
    return {
      status: true,
      data: result,
      message: 'Salesman created successfully',
    };
  }

  async findAll() {
    const data = await this.prisma.salesman.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data };
  }

  async findOne(id: string) {
    const data = await this.prisma.salesman.findUnique({
      where: { id },
    });
    return { status: true, data };
  }

  async update(id: string, updateDto: UpdateSalesmanDto) {
    const result = await this.prisma.salesman.update({
      where: { id },
      data: updateDto,
    });
    return {
      status: true,
      data: result,
      message: 'Salesman updated successfully',
    };
  }

  async remove(id: string) {
    await this.prisma.salesman.delete({
      where: { id },
    });
    return { status: true, message: 'Salesman deleted successfully' };
  }
}
