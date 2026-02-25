import { Injectable, Logger } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { PrismaService } from '../../database/prisma.service';


interface MasterDataCache {
    [key: string]: Map<string, string>; // Map<lowercase_name, id>
}

@Injectable()
export class MasterDataService {
    private readonly logger = new Logger(MasterDataService.name);
    private cache: MasterDataCache = {};

    constructor(private prisma: PrismaService) { }

    /**
     * Get cache key for a master type
     */
    private getCacheKey(type: string): string {
        return type.toLowerCase();
    }

    /**
     * Initialize cache for a master type
     */
    private initCache(type: string): void {
        const key = this.getCacheKey(type);
        if (!this.cache[key]) {
            this.cache[key] = new Map<string, string>();
        }
    }

    /**
     * Get or create Size master record
     */
    async getOrCreateSize(name: string): Promise<string | null> {
        if (!name) return null;

        const normalized = name.trim();
        const cacheKey = this.getCacheKey('size');
        this.initCache('size');

        // Check cache first
        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        // Check database
        let record = await this.prisma.size.findFirst({
            where: { name: { equals: normalized, mode: 'insensitive' } },
        });

        // Create if not found
        if (!record) {
            this.logger.log(`Creating new Size: ${normalized}`);
            record = await this.prisma.size.create({
                data: { name: normalized, status: 'active' },
            });
        }

        // Cache and return
        this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
        return record.id;
    }

    /**
     * Get or create Color master record
     */
    async getOrCreateColor(name: string): Promise<string | null> {
        if (!name) return null;

        const normalized = name.trim();
        const cacheKey = this.getCacheKey('color');
        this.initCache('color');

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        let record = await this.prisma.color.findFirst({
            where: { name: { equals: normalized, mode: 'insensitive' } },
        });

        if (!record) {
            this.logger.log(`Creating new Color: ${normalized}`);
            record = await this.prisma.color.create({
                data: { name: normalized, status: 'active' },
            });
        }

        this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
        return record.id;
    }

    /**
     * Get or create Brand master record
     */
    async getOrCreateBrand(name: string): Promise<string | null> {
        if (!name) return null;

        const normalized = name.trim();
        const cacheKey = this.getCacheKey('brand');
        this.initCache('brand');

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        let record = await this.prisma.brand.findFirst({
            where: { name: { equals: normalized, mode: 'insensitive' } },
        });

        if (!record) {
            this.logger.log(`Creating new Brand: ${normalized}`);
            record = await this.prisma.brand.create({
                data: { name: normalized, status: 'active' },
            });
        }

        this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
        return record.id;
    }

    /**
     * Get or create Division master record
     */
    async getOrCreateDivision(name: string, brandId?: string | null): Promise<string | null> {
        if (!name) return null;

        const normalized = name.trim();
        const cacheKey = this.getCacheKey(`division_${brandId || 'none'}`);
        this.initCache(`division_${brandId || 'none'}`);

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        let record = await this.prisma.division.findFirst({
            where: {
                name: { equals: normalized, mode: 'insensitive' },
                ...(brandId ? { brandId } : {}),
            },
        });

        if (!record && brandId) {
            this.logger.log(`Creating new Division: ${normalized} for brand: ${brandId}`);
            record = await this.prisma.division.create({
                data: {
                    name: normalized,
                    brandId: brandId,
                    status: 'active'
                },
            });
        }

        if (record) {
            this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
            return record.id;
        }

        return null;
    }

    /**
     * Get or create Gender master record
     */
    async getOrCreateGender(name: string): Promise<string | null> {
        if (!name) return null;

        const normalized = name.trim();
        const cacheKey = this.getCacheKey('gender');
        this.initCache('gender');

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        let record = await this.prisma.gender.findFirst({
            where: { name: { equals: normalized, mode: 'insensitive' } },
        });

        if (!record) {
            this.logger.log(`Creating new Gender: ${normalized}`);
            record = await this.prisma.gender.create({
                data: { name: normalized, status: 'active' },
            });
        }

        this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
        return record.id;
    }

    /**
     * Get or create Department master record
     */
    async getOrCreateDepartment(name: string): Promise<string | null> {
        if (!name) return null;

        const normalized = name.trim();
        const cacheKey = this.getCacheKey('department');
        this.initCache('department');

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        let record = await this.prisma.department.findFirst({
            where: { name: { equals: normalized, mode: 'insensitive' } },
        });

        if (!record) {
            this.logger.log(`Creating new Department: ${normalized}`);
            record = await this.prisma.department.create({
                data: { name: normalized },
            });
        }

        this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
        return record.id;
    }

    /**
     * Get or create Category master record
     */
    async getOrCreateCategory(name: string, parentId?: string | null): Promise<string | null> {
        if (!name) return null;

        const normalized = name.trim();
        const cacheKey = this.getCacheKey(`category_${parentId || 'root'}`);
        this.initCache(`category_${parentId || 'root'}`);

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        let record = await this.prisma.category.findFirst({
            where: {
                name: { equals: normalized, mode: 'insensitive' },
                parentId: parentId || null,
            },
        });

        if (!record) {
            this.logger.log(`Creating new Category: ${normalized}`);
            record = await this.prisma.category.create({
                data: {
                    name: normalized,
                    parentId: parentId || null,
                },
            });
        }

        this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
        return record.id;
    }

    /**
     * Get or create Sub-Category master record
     */
    async getOrCreateSubCategory(name: string, categoryId?: string | null): Promise<string | null> {
        if (!name || !categoryId) return null;
        return this.getOrCreateCategory(name, categoryId);
    }

    /**
     * Get or create Item Class master record
     */
    async getOrCreateItemClass(name: string): Promise<string | null> {
        if (!name) return null;

        const normalized = name.trim();
        const cacheKey = this.getCacheKey('itemclass');
        this.initCache('itemclass');

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        let record = await this.prisma.itemClass.findFirst({
            where: { name: { equals: normalized, mode: 'insensitive' } },
        });

        if (!record) {
            this.logger.log(`Creating new ItemClass: ${normalized}`);
            record = await this.prisma.itemClass.create({
                data: { name: normalized, status: 'active' },
            });
        }

        this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
        return record.id;
    }

    /**
     * Get or create Item Subclass master record
     */
    async getOrCreateItemSubclass(name: string, itemClassId?: string | null): Promise<string | null> {
        if (!name || !itemClassId) return null;

        const normalized = name.trim();
        const cacheKey = this.getCacheKey(`itemsubclass_${itemClassId}`);
        this.initCache(`itemsubclass_${itemClassId}`);

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        let record = await this.prisma.itemSubclass.findFirst({
            where: {
                name: { equals: normalized, mode: 'insensitive' },
                itemClassId,
            },
        });

        if (!record) {
            this.logger.log(`Creating new ItemSubclass: ${normalized} for class: ${itemClassId}`);
            record = await this.prisma.itemSubclass.create({
                data: {
                    name: normalized,
                    itemClassId,
                    status: 'active'
                },
            });
        }

        this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
        return record.id;
    }

    /**
     * Get or create Silhouette master record
     */
    async getOrCreateSilhouette(name: string): Promise<string | null> {
        if (!name) return null;

        const normalized = name.trim();
        const cacheKey = this.getCacheKey('silhouette');
        this.initCache('silhouette');

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        let record = await this.prisma.silhouette.findFirst({
            where: { name: { equals: normalized, mode: 'insensitive' } },
        });

        if (!record) {
            this.logger.log(`Creating new Silhouette: ${normalized}`);
            record = await this.prisma.silhouette.create({
                data: { name: normalized, status: 'active' },
            });
        }

        this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
        return record.id;
    }

    /**
     * Get or create Channel Class master record
     */
    async getOrCreateChannelClass(name: string): Promise<string | null> {
        if (!name) return null;

        const normalized = name.trim();
        const cacheKey = this.getCacheKey('channelclass');
        this.initCache('channelclass');

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        let record = await this.prisma.channelClass.findFirst({
            where: { name: { equals: normalized, mode: 'insensitive' } },
        });

        if (!record) {
            this.logger.log(`Creating new ChannelClass: ${normalized}`);
            record = await this.prisma.channelClass.create({
                data: { name: normalized, status: 'active' },
            });
        }

        this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
        return record.id;
    }

    /**
     * Get or create Season master record
     */
    async getOrCreateSeason(name: string): Promise<string | null> {
        if (!name) return null;

        const normalized = name.trim();
        const cacheKey = this.getCacheKey('season');
        this.initCache('season');

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        let record = await this.prisma.season.findFirst({
            where: { name: { equals: normalized, mode: 'insensitive' } },
        });

        if (!record) {
            this.logger.log(`Creating new Season: ${normalized}`);
            record = await this.prisma.season.create({
                data: { name: normalized, status: 'active' },
            });
        }

        this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
        return record.id;
    }



    /**
     * Get or create Segment master record
     */
    async getOrCreateSegment(name: string): Promise<string | null> {
        if (!name) return null;

        const normalized = name.trim();
        const cacheKey = this.getCacheKey('segment');
        this.initCache('segment');

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        let record = await this.prisma.segment.findFirst({
            where: { name: { equals: normalized, mode: 'insensitive' } },
        });

        if (!record) {
            this.logger.log(`Creating new Segment: ${normalized}`);
            record = await this.prisma.segment.create({
                data: { name: normalized, status: 'active' },
            });
        }

        this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
        return record.id;
    }

    /**
     * Clear cache (useful for testing or long-running processes)
     */
    clearCache(): void {
        this.cache = {};
        this.logger.log('Master data cache cleared');
    }
}

