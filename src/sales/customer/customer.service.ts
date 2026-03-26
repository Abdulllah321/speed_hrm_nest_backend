import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer-dto';

@Injectable()
export class CustomerService {
  constructor(private prisma: PrismaService) { }

  async create(createDto: CreateCustomerDto) {
    try {
      const customer = await this.prisma.customer.create({
        data: createDto,
      });
      return {
        status: true,
        data: customer,
        message: 'Customer created successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async findAll(search?: string) {
    try {
      const customers = await this.prisma.customer.findMany({
        where: search
          ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { code: { contains: search, mode: 'insensitive' } },
              { contactNo: { contains: search, mode: 'insensitive' } },
            ],
          }
          : {},
        orderBy: { createdAt: 'desc' },
      });
      return { status: true, data: customers };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async findOne(id: string) {
    try {
      const customer = await this.prisma.customer.findUnique({ where: { id } });
      return {
        status: !!customer,
        data: customer,
        message: customer ? undefined : 'Customer not found',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async update(id: string, updateDto: UpdateCustomerDto) {
    try {
      const customer = await this.prisma.customer.update({
        where: { id },
        data: updateDto,
      });
      return {
        status: true,
        data: customer,
        message: 'Customer updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.customer.delete({ where: { id } });
      return { status: true, message: 'Customer deleted successfully' };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }
}
