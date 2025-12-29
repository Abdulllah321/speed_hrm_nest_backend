import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class EmployeeStatusService {
  constructor(private prisma: PrismaService) { }

  async list() {
    const items = await this.prisma.employeeStatus.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.employeeStatus.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Status not found' }
    return { status: true, data: item }
  }

  async create(data: { status: string; statusType?: string }) {
    try {
      if (!data.status) {
        return { status: false, message: 'Status name is required' };
      }
      const item = await this.prisma.employeeStatus.create({
        data: {
          status: data.status,
          statusType: data.statusType || 'Active',
        },
      });
      return { status: true, data: item, message: 'Employee status created successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to create status' };
    }
  }

  async update(id: string, data: { status?: string; statusType?: string }) {
    try {
      const item = await this.prisma.employeeStatus.update({
        where: { id },
        data,
      });
      return { status: true, data: item, message: 'Employee status updated successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to update status' };
    }
  }

  async delete(id: string) {
    try {
      await this.prisma.employeeStatus.delete({ where: { id } });
      return { status: true, message: 'Employee status deleted successfully' };
    } catch (error) {
      return { status: false, message: error instanceof Error ? error.message : 'Failed to delete status' };
    }
  }

  async bulkCreate(items: { status: string; statusType?: string }[]) {
    try {
      const validData = items
        .filter((item) => item.status && item.status.trim().length > 0)
        .map((item) => ({
          status: item.status.trim(),
          statusType: item.statusType || 'Active', // Default or verify actual schema requirement
        }));

      if (validData.length === 0) {
        return { status: false, message: 'No valid data provided' };
      }

      await this.prisma.employeeStatus.createMany({
        data: validData,
        skipDuplicates: true,
      });

      return { status: true, message: 'Employee statuses created successfully' };
    } catch (error) {
      let errorMessage = 'Failed to create employee statuses';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      return { status: false, message: errorMessage };
    }
  }
}
