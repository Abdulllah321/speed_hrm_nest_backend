import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreatePayeeDto, UpdatePayeeDto } from './dto/payee.dto';

@Injectable()
export class PayeeService {
  constructor(private prisma: PrismaService) {}

  private getModel(type: 'director' | 'salary' | 'tax') {
    switch (type) {
      case 'director':
        return this.prisma.payeeDirector;
      case 'salary':
        return this.prisma.payeeSalary;
      case 'tax':
        return this.prisma.payeeTax;
      default:
        throw new BadRequestException('Invalid payee type');
    }
  }

  async create(type: 'director' | 'salary' | 'tax', data: CreatePayeeDto, userId?: string) {
    const model: any = this.getModel(type);
    
    const existing = await model.findUnique({ where: { code: data.code } });
    if (existing) {
      throw new BadRequestException('Code already exists');
    }

    return model.create({
      data: {
        ...data,
        ...(userId ? { createdById: userId } : {}),
      },
    });
  }

  async findAll(type: 'director' | 'salary' | 'tax') {
    const model: any = this.getModel(type);
    return model.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async findOne(type: 'director' | 'salary' | 'tax', id: string) {
    const model: any = this.getModel(type);
    const payee = await model.findUnique({ where: { id } });
    if (!payee) {
      throw new NotFoundException('Payee not found');
    }
    return payee;
  }

  async update(type: 'director' | 'salary' | 'tax', id: string, data: UpdatePayeeDto) {
    const model: any = this.getModel(type);
    
    if (data.code) {
      const existing = await model.findUnique({ where: { code: data.code } });
      if (existing && existing.id !== id) {
        throw new BadRequestException('Code already exists');
      }
    }

    try {
      return await model.update({
        where: { id },
        data,
      });
    } catch (error) {
      throw new NotFoundException('Payee not found');
    }
  }

  async remove(type: 'director' | 'salary' | 'tax', id: string) {
    const model: any = this.getModel(type);
    try {
      return await model.delete({ where: { id } });
    } catch (error) {
      throw new NotFoundException('Payee not found');
    }
  }
}
