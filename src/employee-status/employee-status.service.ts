import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class EmployeeStatusService {
  constructor(private prisma: PrismaService) {}

  async list() {
    const items = await this.prisma.employeeStatus.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.employeeStatus.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Status not found' }
    return { status: true, data: item }
  }
}
