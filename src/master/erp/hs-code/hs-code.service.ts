import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { CreateHsCodeDto, UpdateHsCodeDto } from './hs-code.dto';

@Injectable()
export class HsCodeService {
    constructor(private readonly prisma: PrismaService) { }

    async create(dto: CreateHsCodeDto) {
        const data = await this.prisma.hsCode.create({
            data: {
                hsCode: dto.hsCode,
                customsDutyCd: dto.customsDutyCd ?? 0,
                regulatoryDutyRd: dto.regulatoryDutyRd ?? 0,
                additionalCustomsDutyAcd: dto.additionalCustomsDutyAcd ?? 0,
                salesTax: dto.salesTax ?? 0,
                additionalSalesTax: dto.additionalSalesTax ?? 0,
                incomeTax: dto.incomeTax ?? 0,
                status: dto.status ?? 'active',
            },
        });
        return { status: true, data };
    }

    async list() {
        const items = await this.prisma.hsCode.findMany({
            orderBy: [{ hsCode: 'asc' }],
        });
        return { status: true, data: items };
    }

    async get(id: string) {
        const item = await this.prisma.hsCode.findUnique({ where: { id } });
        if (!item) {
            throw new NotFoundException('HS Code not found');
        }
        return { status: true, data: item };
    }

    async update(id: string, dto: UpdateHsCodeDto) {
        await this.get(id);
        const data = await this.prisma.hsCode.update({
            where: { id },
            data: {
                hsCode: dto.hsCode ?? undefined,
                customsDutyCd: dto.customsDutyCd ?? undefined,
                regulatoryDutyRd: dto.regulatoryDutyRd ?? undefined,
                additionalCustomsDutyAcd: dto.additionalCustomsDutyAcd ?? undefined,
                salesTax: dto.salesTax ?? undefined,
                additionalSalesTax: dto.additionalSalesTax ?? undefined,
                incomeTax: dto.incomeTax ?? undefined,
                status: dto.status ?? undefined,
            },
        });
        return { status: true, data };
    }

    async remove(id: string) {
        await this.get(id);
        await this.prisma.hsCode.delete({ where: { id } });
        return { status: true };
    }
}
