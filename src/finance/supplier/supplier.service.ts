import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';

@Injectable()
export class SupplierService {
  constructor(
    private prisma: PrismaService,
    private activityLogs: ActivityLogsService,
  ) {}

  async getNextSupplierCode(): Promise<{ status: boolean; code: string }> {
    try {
      const suppliers = await this.prisma.supplier.findMany({
        select: { code: true },
      });
      let maxNum = 120000;
      for (const s of suppliers) {
        if (s.code && /^\d+$/.test(s.code.trim())) {
          const val = parseInt(s.code.trim(), 10);
          if (!isNaN(val) && val > maxNum) {
            maxNum = val;
          }
        }
      }
      const nextCode = String(maxNum + 1);
      return { status: true, code: nextCode };
    } catch (error: any) {
      return { status: false, code: '120001' };
    }
  }

  async create(createSupplierDto: CreateSupplierDto) {
    try {
      const { brandIds, ...restDto } = createSupplierDto;
      let code = restDto.code;
      if (!code) {
        const nextRes = await this.getNextSupplierCode();
        code = nextRes.code;
      }
      const supplier = await this.prisma.supplier.create({
        data: {
          ...restDto,
          code,
          ...(brandIds && brandIds.length > 0 && {
            supplierBrands: {
              create: brandIds.map((bId) => ({ brandId: bId })),
            },
          }),
        },
        include: {
          supplierBrands: { include: { brand: true } },
        },
      });

      const brandNames = supplier.supplierBrands?.map((sb) => sb.brand.name).join(', ') || supplier.brand || '';
      return {
        status: true,
        data: {
          ...supplier,
          brandIds: supplier.supplierBrands?.map((sb) => sb.brandId) || [],
          brands: supplier.supplierBrands?.map((sb) => sb.brand) || [],
          brand: brandNames,
        },
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
          supplierBrands: { include: { brand: true } },
        },
      });

      const formatted = suppliers.map((s) => {
        const bNames = s.supplierBrands?.map((sb) => sb.brand.name).join(', ') || s.brand || '';
        return {
          ...s,
          brandIds: s.supplierBrands?.map((sb) => sb.brandId) || [],
          brands: s.supplierBrands?.map((sb) => sb.brand) || [],
          brand: bNames,
        };
      });

      return { status: true, data: formatted };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async findOne(id: string) {
    try {
      const supplier = await this.prisma.supplier.findUnique({
        where: { id },
        include: {
          supplierBrands: { include: { brand: true } },
        },
      });
      if (!supplier) return { status: false, message: 'Supplier not found' };

      const bNames = supplier.supplierBrands?.map((sb) => sb.brand.name).join(', ') || supplier.brand || '';
      return {
        status: true,
        data: {
          ...supplier,
          brandIds: supplier.supplierBrands?.map((sb) => sb.brandId) || [],
          brands: supplier.supplierBrands?.map((sb) => sb.brand) || [],
          brand: bNames,
        },
      };
    } catch (error: any) {
      return { status: false, message: error.message, data: null };
    }
  }

  async update(id: string, updateSupplierDto: UpdateSupplierDto) {
    try {
      const { brandIds, ...restDto } = updateSupplierDto;

      if (brandIds !== undefined) {
        await this.prisma.supplierBrand.deleteMany({
          where: { supplierId: id },
        });
        if (brandIds.length > 0) {
          await this.prisma.supplierBrand.createMany({
            data: brandIds.map((bId) => ({ supplierId: id, brandId: bId })),
          });
        }
      }

      const supplier = await this.prisma.supplier.update({
        where: { id },
        data: restDto,
        include: {
          supplierBrands: { include: { brand: true } },
        },
      });

      const bNames = supplier.supplierBrands?.map((sb) => sb.brand.name).join(', ') || supplier.brand || '';
      return {
        status: true,
        data: {
          ...supplier,
          brandIds: supplier.supplierBrands?.map((sb) => sb.brandId) || [],
          brands: supplier.supplierBrands?.map((sb) => sb.brand) || [],
          brand: bNames,
        },
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
