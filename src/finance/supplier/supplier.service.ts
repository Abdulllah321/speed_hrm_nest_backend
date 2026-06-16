import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { AccountRoleKey } from '../finance-account-config/dto/finance-account-config.dto';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
@Injectable()
export class SupplierService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async create(createSupplierDto: CreateSupplierDto) {
    try {
      const { chartOfAccountIds, ...data } = createSupplierDto;
      const supplier = await this.prisma.supplier.create({
        data: {
          ...data,
          chartOfAccounts: {
            connect: chartOfAccountIds?.map((id) => ({ id })),
          },
        },
      });
      return {
        status: true,
        data: supplier,
        message: 'Supplier created successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async findAll() {
    try {
      const suppliers = await this.prisma.supplier.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          chartOfAccounts: {
            select: { code: true, name: true },
          },
        },
      });
      return { status: true, data: suppliers };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async findOne(id: string) {
    try {
      const supplier = await this.prisma.supplier.findUnique({
        where: { id },
        include: {
          chartOfAccounts: {
            select: { code: true, name: true, id: true },
          },
        },
      });
      if (!supplier) return { status: false, message: 'Supplier not found' };

      // Resolve AP_PARTIES account ID
      let apPartiesAccountId: string | null = null;
      let tagAccountId: string | null = null;
      try {
        const config = await this.prisma.financeAccountConfig.findUnique({
          where: { key: AccountRoleKey.AP_PARTIES as any },
          select: { accountId: true },
        });
        if (config) {
          apPartiesAccountId = config.accountId;
          
          const tagAccount = await this.prisma.chartOfAccount.findFirst({
            where: {
              parentId: apPartiesAccountId,
              code: supplier.code,
            },
            select: { id: true },
          });
          if (tagAccount) {
            tagAccountId = tagAccount.id;
          }
        }
      } catch (err) {
        // Ignore
      }

      return {
        status: true,
        data: {
          ...supplier,
          apPartiesAccountId,
          tagAccountId,
        },
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async update(id: string, updateSupplierDto: UpdateSupplierDto) {
    try {
      const { chartOfAccountIds, ...data } = updateSupplierDto;
      const supplier = await this.prisma.supplier.update({
        where: { id },
        data: {
          ...data,
          chartOfAccounts: chartOfAccountIds
            ? {
                set: chartOfAccountIds.map((id) => ({ id })),
              }
            : undefined,
        },
      });
      return {
        status: true,
        data: supplier,
        message: 'Supplier updated successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async remove(id: string) {
    try {
      const supplier = await this.prisma.supplier.delete({
        where: { id },
      });
      return {
        status: true,
        data: supplier,
        message: 'Supplier deleted successfully',
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }
}
