import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaMasterService } from '../../../database/prisma-master.service';
import { CreateItemDto, UpdateItemDto } from './dto/item.dto';

@Injectable()
export class ItemService {
    constructor(private prisma: PrismaMasterService) { }

    async create(createItemDto: CreateItemDto) {
        try {
            const data = await this.prisma.item.create({
                data: createItemDto,
            });
            return { status: true, data, message: 'Item created successfully' };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    async findAll() {
        const items = await this.prisma.item.findMany({
            include: {
                brand: true,
                division: true,
                category: true,
                subCategory: true,
                season: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        return { status: true, data: items };
    }

    async findOne(id: string) {
        const item = await this.prisma.item.findUnique({
            where: { id },
            include: {
                brand: true,
                division: true,
                gender: true,
                size: true,
                silhouette: true,
                channelClass: true,
                color: true,
                category: true,
                subCategory: true,
                itemClass: true,
                itemSubclass: true,
                season: true,
                uom: true,
            },
        });

        if (!item) {
            return { status: false, message: `Item with ID ${id} not found` };
        }

        return { status: true, data: item };
    }

    async update(id: string, updateItemDto: UpdateItemDto) {
        try {
            const findResult = await this.findOne(id);
            if (!findResult.status) return findResult;

            const data = await this.prisma.item.update({
                where: { id },
                data: updateItemDto,
            });
            return { status: true, data, message: 'Item updated successfully' };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }

    async remove(id: string) {
        try {
            const findResult = await this.findOne(id);
            if (!findResult.status) return findResult;

            await this.prisma.item.delete({
                where: { id },
            });
            return { status: true, message: 'Item deleted successfully' };
        } catch (error: any) {
            return { status: false, message: error.message };
        }
    }
}
