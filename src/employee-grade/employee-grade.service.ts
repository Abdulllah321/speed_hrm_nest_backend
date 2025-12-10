import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class EmployeeGradeService {
  constructor(private prisma: PrismaService) {}

  async list() {
    const items = await this.prisma.employeeGrade.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.employeeGrade.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Grade not found' }
    return { status: true, data: item }
  }
}
