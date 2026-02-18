import { Injectable } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { CreateMachineDto, UpdateMachineDto } from './dto/machine-dto';

@Injectable()
export class MachineService {
  constructor(private prisma: PrismaMasterService) {}

  async create(createDto: CreateMachineDto, userId: string) {
    const result = await this.prisma.machine.create({
      data: {
        ...createDto,
        createdById: userId,
      },
    });
    return {
      status: true,
      data: result,
      message: 'Machine created successfully',
    };
  }

  async findAll() {
    const data = await this.prisma.machine.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data };
  }

  async findOne(id: string) {
    const data = await this.prisma.machine.findUnique({
      where: { id },
    });
    return { status: true, data };
  }

  async update(id: string, updateDto: UpdateMachineDto) {
    const result = await this.prisma.machine.update({
      where: { id },
      data: updateDto,
    });
    return {
      status: true,
      data: result,
      message: 'Machine updated successfully',
    };
  }

  async remove(id: string) {
    await this.prisma.machine.delete({
      where: { id },
    });
    return { status: true, message: 'Machine deleted successfully' };
  }
}
