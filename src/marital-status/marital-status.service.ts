import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class MaritalStatusService {
  constructor(private prisma: PrismaService) {}

  async list() {
    const items = await this.prisma.maritalStatus.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: items }
  }

  async get(id: string) {
    const item = await this.prisma.maritalStatus.findUnique({ where: { id } })
    if (!item) return { status: false, message: 'Marital status not found' }
    return { status: true, data: item }
  }
}
