import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class EmployeeGradeService {
  constructor(private prisma: PrismaService) {}

  async list() {
    const items = await this.prisma.employeeGrade.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.employeeGrade.findUnique({ where: { id } });
    if (!item) return { status: false, message: 'Grade not found' };
    return { status: true, data: item };
  }

  async create(data: { grade: string; status?: string }) {
    try {
      if (!data.grade) {
        return { status: false, message: 'Grade name is required' };
      }
      const item = await this.prisma.employeeGrade.create({
        data: {
          grade: data.grade,
          status: data.status || 'Active',
        },
      });
      return {
        status: true,
        data: item,
        message: 'Employee grade created successfully',
      };
    } catch (error) {
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to create grade',
      };
    }
  }

  async update(id: string, data: { grade?: string; status?: string }) {
    try {
      const item = await this.prisma.employeeGrade.update({
        where: { id },
        data,
      });
      return {
        status: true,
        data: item,
        message: 'Employee grade updated successfully',
      };
    } catch (error) {
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to update grade',
      };
    }
  }

  async delete(id: string) {
    try {
      await this.prisma.employeeGrade.delete({ where: { id } });
      return { status: true, message: 'Employee grade deleted successfully' };
    } catch (error) {
      return {
        status: false,
        message:
          error instanceof Error ? error.message : 'Failed to delete grade',
      };
    }
  }

  async bulkCreate(items: { grade: string; status?: string }[]) {
    try {
      const validData = items
        .filter((item) => item.grade && item.grade.trim().length > 0)
        .map((item) => ({
          grade: item.grade.trim(),
          status: item.status || 'Active',
        }));

      if (validData.length === 0) {
        return { status: false, message: 'No valid data provided' };
      }

      await this.prisma.employeeGrade.createMany({
        data: validData,
        skipDuplicates: true,
      });

      return { status: true, message: 'Employee grades created successfully' };
    } catch (error) {
      let errorMessage = 'Failed to create employee grades';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      return { status: false, message: errorMessage };
    }
  }
}
