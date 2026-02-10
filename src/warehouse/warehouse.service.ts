import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Warehouse, WarehouseLocation } from '@prisma/client';

@Injectable()
export class WarehouseService {
    constructor(private prisma: PrismaService) { }

    async createWarehouse(data: any): Promise<Warehouse> {
        return this.prisma.warehouse.create({ data });
    }

    async findAllWarehouses(): Promise<Warehouse[]> {
        return this.prisma.warehouse.findMany({
            include: {
                _count: {
                    select: { locations: true },
                },
            },
        });
    }

    async findOneWarehouse(id: string): Promise<Warehouse> {
        const warehouse = await this.prisma.warehouse.findUnique({
            where: { id },
            include: {
                locations: true,
            },
        });
        if (!warehouse) throw new NotFoundException(`Warehouse with ID ${id} not found`);
        return warehouse;
    }

    async updateWarehouse(id: string, data: any): Promise<Warehouse> {
        return this.prisma.warehouse.update({
            where: { id },
            data,
        });
    }

    async removeWarehouse(id: string): Promise<Warehouse> {
        return this.prisma.warehouse.delete({ where: { id } });
    }

    // Location Management
    async createLocation(data: any): Promise<WarehouseLocation> {
        return this.prisma.warehouseLocation.create({ data });
    }

    async findLocationsByWarehouse(warehouseId: string): Promise<WarehouseLocation[]> {
        return this.prisma.warehouseLocation.findMany({
            where: { warehouseId },
            orderBy: { code: 'asc' },
        });
    }
}
