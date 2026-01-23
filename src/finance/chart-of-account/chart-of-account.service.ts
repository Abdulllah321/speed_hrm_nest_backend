import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateChartOfAccountDto, UpdateChartOfAccountDto } from './dto/chart-of-account.dto';

@Injectable()
export class ChartOfAccountService {
  constructor(private prisma: PrismaService) {}

  async create(createDto: CreateChartOfAccountDto, context: { userId?: string }) {
    const { code, parentId } = createDto;

    // Check for unique code
    const existing = await this.prisma.chartOfAccount.findUnique({
      where: { code },
    });
    if (existing) {
      throw new BadRequestException('Account code must be unique');
    }

    // Validate parent if provided
    if (parentId) {
      const parent = await this.prisma.chartOfAccount.findUnique({
        where: { id: parentId },
      });
      if (!parent) {
        throw new NotFoundException('Parent account not found');
      }
      if (!parent.isGroup) {
        throw new BadRequestException('Parent account must be a group account');
      }
    }

    return this.prisma.chartOfAccount.create({
      data: {
        ...createDto,
        ...(context.userId ? { createdById: context.userId } : {}),
      },
    });
  }

  async findAll() {
    // Return all accounts, frontend can build the tree
    return this.prisma.chartOfAccount.findMany({
      orderBy: { code: 'asc' },
      include: {
        parent: {
          select: { id: true, name: true, code: true }
        }
      }
    });
  }

  async findOne(id: string) {
    const account = await this.prisma.chartOfAccount.findUnique({
      where: { id },
      include: {
        parent: true,
        children: true,
      },
    });

    if (!account) {
      throw new NotFoundException('Chart of account not found');
    }

    return account;
  }

  async update(id: string, updateDto: UpdateChartOfAccountDto, context: { userId?: string }) {
    const account = await this.prisma.chartOfAccount.findUnique({
      where: { id },
    });

    if (!account) {
      throw new NotFoundException('Chart of account not found');
    }

    // If changing code, check uniqueness
    if (updateDto.code && updateDto.code !== account.code) {
      const existing = await this.prisma.chartOfAccount.findUnique({
        where: { code: updateDto.code },
      });
      if (existing) {
        throw new BadRequestException('Account code must be unique');
      }
    }

    // Validate parent loop
    if (updateDto.parentId && updateDto.parentId !== account.parentId) {
        if (updateDto.parentId === id) {
             throw new BadRequestException('Account cannot be its own parent');
        }
        // Basic cycle check (only 1 level deep check for now, or recursive could be added)
        const parent = await this.prisma.chartOfAccount.findUnique({ where: { id: updateDto.parentId }});
        if (!parent) throw new NotFoundException('Parent account not found');
        if (!parent.isGroup) throw new BadRequestException('Parent account must be a group');
    }

    return this.prisma.chartOfAccount.update({
      where: { id },
      data: {
        ...updateDto,
        // createdById is not updated
      },
    });
  }

  async remove(id: string) {
    const account = await this.prisma.chartOfAccount.findUnique({
      where: { id },
      include: { children: true },
    });

    if (!account) {
      throw new NotFoundException('Chart of account not found');
    }

    if (account.children && account.children.length > 0) {
      throw new BadRequestException('Cannot delete account with children. Delete or move children first.');
    }

    return this.prisma.chartOfAccount.delete({
      where: { id },
    });
  }
}
