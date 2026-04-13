import { PrismaService } from '../../../database/prisma.service';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaMasterService } from '../../../database/prisma-master.service';
import { CreateTaxRateDto, UpdateTaxRateDto } from './tax-rate.dto';

@Injectable()
export class TaxRateService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTaxRateDto) {
    const data = await this.prisma.taxRate1.create({
      data: {
        taxRate1: dto.taxRate1 ?? 0,
      },
    });
    return { status: true, data };
  }

  async list() {
    const items = await this.prisma.taxRate1.findMany({
      orderBy: [{ createdAt: 'desc' }],
    });
    return { status: true, data: items };
  }

  async get(id: string) {
    const item = await this.prisma.taxRate1.findUnique({ where: { id } });
    if (!item) {
      throw new NotFoundException('Tax Rate not found');
    }
    return { status: true, data: item };
  }

  async update(id: string, dto: UpdateTaxRateDto) {
    await this.get(id);
    const data = await this.prisma.taxRate1.update({
      where: { id },
      data: {
        taxRate1: dto.taxRate1 ?? undefined,
      },
    });
    return { status: true, data };
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.taxRate1.delete({ where: { id } });
    return { status: true };
  }
}
