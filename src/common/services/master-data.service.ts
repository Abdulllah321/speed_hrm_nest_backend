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
    private pendingPromises: Map<string, Promise<string | null>> = new Map();

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
     * Unified resolver to handle parallel safety
     */
    private async resolveOrCreate(
        type: string,
        name: string,
        parentId: string | null,
        fetcher: () => Promise<{ id: string } | null>,
        creator: () => Promise<{ id: string }>
    ): Promise<string | null> {
        if (!name) return null;

        const normalized = name.trim();
        const cacheKey = this.getCacheKey(parentId ? `${type}_${parentId}` : type);
        this.initCache(parentId ? `${type}_${parentId}` : type);

        // 1. Sync Cache
        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        // 2. In-flight Promise (Parallel safety)
        const promiseKey = `${cacheKey}:${normalized.toLowerCase()}`;
        const existingPromise = this.pendingPromises.get(promiseKey);
        if (existingPromise) return existingPromise;

        // 3. Create new resolution promise
        const resolution = (async () => {
            try {
                // Check DB
                let record = await fetcher();

                // Create if missing
                if (!record) {
                    this.logger.log(`Creating new ${type}: ${normalized}`);
                    record = await creator();
                }

                // Update sync cache
                this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
                return record.id;
            } catch (error) {
                this.logger.error(`Failed to resolve ${type} for ${normalized}: ${error.message}`);
                return null;
            } finally {
                // Cleanup pending map
                this.pendingPromises.delete(promiseKey);
            }
        })();

        this.pendingPromises.set(promiseKey, resolution);
        return resolution;
    }

    /**
     * Get or create Size master record
     */
    async getOrCreateSize(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'size', name, null,
            () => this.prisma.size.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.size.create({ data: { name: name.trim(), status: 'active' } })
        );
    }

    /**
     * Get or create Color master record
     */
    async getOrCreateColor(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'color', name, null,
            () => this.prisma.color.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.color.create({ data: { name: name.trim(), status: 'active' } })
        );
    }

    /**
     * Get or create Brand master record
     */
    async getOrCreateBrand(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'brand', name, null,
            () => this.prisma.brand.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.brand.create({ data: { name: name.trim(), status: 'active' } })
        );
    }

    /**
     * Get or create Division master record
     */
    async getOrCreateDivision(name: string, brandId?: string | null): Promise<string | null> {
        if (!brandId) return null;
        return this.resolveOrCreate(
            'division', name, brandId,
            () => this.prisma.division.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' }, brandId } }),
            () => this.prisma.division.create({ data: { name: name.trim(), brandId, status: 'active' } })
        );
    }

    /**
     * Get or create Gender master record
     */
    async getOrCreateGender(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'gender', name, null,
            () => this.prisma.gender.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.gender.create({ data: { name: name.trim(), status: 'active' } })
        );
    }

    /**
     * Get or create Department master record
     */
    async getOrCreateDepartment(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'department', name, null,
            () => this.prisma.department.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.department.create({ data: { name: name.trim() } })
        );
    }

    /**
     * Get or create Category master record
     */
    async getOrCreateCategory(name: string, parentId?: string | null): Promise<string | null> {
        return this.resolveOrCreate(
            'category', name, parentId || null,
            () => this.prisma.category.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' }, parentId: parentId || null } }),
            () => this.prisma.category.create({ data: { name: name.trim(), parentId: parentId || null } })
        );
    }

    /**
     * Get or create Sub-Category master record
     */
    async getOrCreateSubCategory(name: string, categoryId?: string | null): Promise<string | null> {
        if (!categoryId) return null;
        return this.getOrCreateCategory(name, categoryId);
    }

    /**
     * Get or create Item Class master record
     */
    async getOrCreateItemClass(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'itemclass', name, null,
            () => this.prisma.itemClass.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.itemClass.create({ data: { name: name.trim(), status: 'active' } })
        );
    }

    /**
     * Get or create Item Subclass master record
     */
    async getOrCreateItemSubclass(name: string, itemClassId?: string | null): Promise<string | null> {
        if (!itemClassId) return null;
        return this.resolveOrCreate(
            'itemsubclass', name, itemClassId,
            () => this.prisma.itemSubclass.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' }, itemClassId } }),
            () => this.prisma.itemSubclass.create({ data: { name: name.trim(), itemClassId, status: 'active' } })
        );
    }

    /**
     * Get or create Silhouette master record
     */
    async getOrCreateSilhouette(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'silhouette', name, null,
            () => this.prisma.silhouette.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.silhouette.create({ data: { name: name.trim(), status: 'active' } })
        );
    }

    /**
     * Get or create Channel Class master record
     */
    async getOrCreateChannelClass(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'channelclass', name, null,
            () => this.prisma.channelClass.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.channelClass.create({ data: { name: name.trim(), status: 'active' } })
        );
    }

    /**
     * Get or create Season master record
     */
    async getOrCreateSeason(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'season', name, null,
            () => this.prisma.season.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.season.create({ data: { name: name.trim(), status: 'active' } })
        );
    }

    /**
     * Get or create Segment master record
     */
    async getOrCreateSegment(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'segment', name, null,
            () => this.prisma.segment.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.segment.create({ data: { name: name.trim(), status: 'active' } })
        );
    }

    /**
     * Find HS Code master record (No creation)
     */
    async findHsCode(code: string): Promise<string | null> {
        if (!code) return null;

        const normalized = code.trim();
        const cacheKey = this.getCacheKey('hscode');
        this.initCache('hscode');

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        const record = await this.prisma.hsCode.findFirst({
            where: { hsCode: { equals: normalized, mode: 'insensitive' } },
        });

        if (record) {
            this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
            return record.id;
        }

        return null;
    }

    /**
     * Get or create HS Code master record
     */
    async getOrCreateHsCode(code: string): Promise<string | null> {
        return this.resolveOrCreate(
            'hscode', code, null,
            () => this.prisma.hsCode.findFirst({ where: { hsCode: { equals: code.trim(), mode: 'insensitive' } } }),
            () => this.prisma.hsCode.create({ data: { hsCode: code.trim() } })
        );
    }

    /**
     * Clear cache (useful for testing or long-running processes)
     */
    clearCache(): void {
        this.cache = {};
        this.logger.log('Master data cache cleared');
    }
}

