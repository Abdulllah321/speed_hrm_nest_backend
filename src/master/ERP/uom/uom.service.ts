import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaMasterService } from '../../../database/prisma-master.service';
import { CreateUomDto } from './dto/create-uom.dto';
import { UpdateUomDto } from './dto/update-uom.dto';

@Injectable()
export class UomService {
  constructor(private readonly prisma: PrismaMasterService) {}

  async create(createUomDto: CreateUomDto) {
    return this.prisma.uom.create({
      data: createUomDto,
    });
  }

  async findAll() {
    return this.prisma.uom.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const uom = await this.prisma.uom.findUnique({
      where: { id },
    });

    if (!uom) {
      throw new NotFoundException(`UOM with ID ${id} not found`);
    }

    return uom;
  }

  async update(id: string, updateUomDto: UpdateUomDto) {
    await this.findOne(id);
    return this.prisma.uom.update({
      where: { id },
      data: updateUomDto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.uom.delete({
      where: { id },
    });
  }
}
