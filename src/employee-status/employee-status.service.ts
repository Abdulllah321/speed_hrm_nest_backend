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
