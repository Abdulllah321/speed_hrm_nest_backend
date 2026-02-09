import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';

@Injectable()
export class SupplierService {
    constructor(private prisma: PrismaService) { }

    async create(createSupplierDto: CreateSupplierDto) {
        try {
            const supplier = await this.prisma.supplier.create({
                data: createSupplierDto,
            });
            return { status: true, data: supplier, message: 'Supplier created successfully' };
        } catch (error: any) {
            return { status: false, message: error.message, data: null };
        }
    }

    async findAll() {
        try {
            const suppliers = await this.prisma.supplier.findMany({
                orderBy: { createdAt: 'desc' },
                include: {
                    chartOfAccount: {
                        select: { code: true, name: true }
                    }
                }
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
                    chartOfAccount: {
                        select: { code: true, name: true }
                    }
                }
            });
            if (!supplier) return { status: false, message: 'Supplier not found' };
            return { status: true, data: supplier };
        } catch (error: any) {
            return { status: false, message: error.message, data: null };
        }
    }

    async update(id: string, updateSupplierDto: UpdateSupplierDto) {
        try {
            const supplier = await this.prisma.supplier.update({
                where: { id },
                data: updateSupplierDto,
            });
            return { status: true, data: supplier, message: 'Supplier updated successfully' };
        } catch (error: any) {
            return { status: false, message: error.message, data: null };
        }
    }

    async remove(id: string) {
        try {
            const supplier = await this.prisma.supplier.delete({
                where: { id },
            });
            return { status: true, data: supplier, message: 'Supplier deleted successfully' };
        } catch (error: any) {
            return { status: false, message: error.message, data: null };
        }
    }
}
