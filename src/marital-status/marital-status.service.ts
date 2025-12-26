import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class MaritalStatusService {
  constructor(private prisma: PrismaService) { }

  async list() {
    const items = await this.prisma.maritalStatus.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.maritalStatus.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Marital status not found' }
    return { status: true, data: item }
  }

  async bulkCreate(names: string[]) {
    try {
      // Filter out empty names and map to objects
      const validData = names
        .filter((name) => name && typeof name === 'string' && name.trim().length > 0)
        .map(name => ({
          name: name.trim(),
          status: 'Active'
        }));

      if (validData.length === 0) {
        return { status: false, message: 'No valid data provided' };
      }

      await this.prisma.maritalStatus.createMany({
        data: validData,
        skipDuplicates: true,
      });

      return { status: true, message: 'Marital statuses created successfully' };
    } catch (error) {
      let errorMessage = 'Failed to create marital statuses';
      if (error instanceof Error) {
        errorMessage = error.message;
      }
      return { status: false, message: errorMessage };
    }
  }
}
