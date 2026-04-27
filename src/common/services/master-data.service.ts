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
     * Get or create Sub-Department master record
     */
    async getOrCreateSubDepartment(name: string, departmentId?: string | null): Promise<string | null> {
        if (!departmentId) return null;
        return this.resolveOrCreate(
            'subdepartment', name, departmentId,
            () => this.prisma.subDepartment.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' }, departmentId } }),
            () => this.prisma.subDepartment.create({ data: { name: name.trim(), departmentId } })
        );
    }

    /**
     * Get or create Designation master record
     */
    async getOrCreateDesignation(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'designation', name, null,
            () => this.prisma.designation.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.designation.create({ data: { name: name.trim() } })
        );
    }

    /**
     * Get or create Employee Grade master record
     */
    async getOrCreateEmployeeGrade(grade: string): Promise<string | null> {
        return this.resolveOrCreate(
            'employeegrade', grade, null,
            () => this.prisma.employeeGrade.findFirst({ where: { grade: { equals: grade.trim(), mode: 'insensitive' } } }),
            () => this.prisma.employeeGrade.create({ data: { grade: grade.trim() } })
        );
    }

    /**
     * Get or create Marital Status master record
     */
    async getOrCreateMaritalStatus(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'maritalstatus', name, null,
            () => this.prisma.maritalStatus.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.maritalStatus.create({ data: { name: name.trim() } })
        );
    }

    /**
     * Get or create Employment Status master record
     */
    async getOrCreateEmploymentStatus(status: string): Promise<string | null> {
        return this.resolveOrCreate(
            'employmentstatus', status, null,
            () => this.prisma.employeeStatus.findFirst({ where: { status: { equals: status.trim(), mode: 'insensitive' } } }),
            () => this.prisma.employeeStatus.create({ data: { status: status.trim() } })
        );
    }

    /**
     * Get or create Location master record
     */
    async getOrCreateLocation(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'location', name, null,
            () => this.prisma.location.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.location.create({ data: { name: name.trim() } })
        );
    }

    /**
     * Get or create Working Hours Policy master record
     */
    async getOrCreateWorkingHoursPolicy(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'workinghourspolicy', name, null,
            () => this.prisma.workingHoursPolicy.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.workingHoursPolicy.create({
                data: {
                    name: name.trim(),
                    startWorkingHours: '09:00',
                    endWorkingHours: '18:00',
                }
            })
        );
    }

    /**
     * Get or create Leaves Policy master record
     */
    async getOrCreateLeavesPolicy(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'leavespolicy', name, null,
            () => this.prisma.leavesPolicy.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.leavesPolicy.create({ data: { name: name.trim() } })
        );
    }

    /**
     * Get or create Allocation master record
     */
    async getOrCreateAllocation(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'allocation', name, null,
            () => this.prisma.allocation.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.allocation.create({ data: { name: name.trim() } })
        );
    }

    /**
     * Get or create Qualification master record
     */
    async getOrCreateQualification(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'qualification', name, null,
            () => this.prisma.qualification.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.qualification.create({ data: { name: name.trim(), status: 'active' } })
        );
    }

    /**
     * Get or create Institute master record
     */
    async getOrCreateInstitute(name: string): Promise<string | null> {
        return this.resolveOrCreate(
            'institute', name, null,
            () => this.prisma.institute.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' } } }),
            () => this.prisma.institute.create({ data: { name: name.trim(), status: 'active' } })
        );
    }

    /**
     * Find Country by name
     */
    async findCountryByName(name: string): Promise<string | null> {
        if (!name) return null;
        const normalized = name.trim();
        const cacheKey = this.getCacheKey('country');
        this.initCache('country');

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        const record = await this.prisma.country.findFirst({
            where: { name: { equals: normalized, mode: 'insensitive' } },
        });

        if (record) {
            this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
            return record.id;
        }
        return null;
    }

    /**
     * Find State by name and countryId
     */
    async findStateByName(name: string, countryId: string): Promise<string | null> {
        if (!name || !countryId) return null;
        const normalized = name.trim();
        const cacheKey = this.getCacheKey(`state_${countryId}`);
        this.initCache(`state_${countryId}`);

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        const record = await this.prisma.state.findFirst({
            where: {
                name: { equals: normalized, mode: 'insensitive' },
                countryId
            },
        });

        if (record) {
            this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
            return record.id;
        }
        return null;
    }

    /**
     * Find City by name and stateId
     */
    async findCityByName(name: string, stateId: string): Promise<string | null> {
        if (!name || !stateId) return null;
        const normalized = name.trim();
        const cacheKey = this.getCacheKey(`city_${stateId}`);
        this.initCache(`city_${stateId}`);

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        const record = await this.prisma.city.findFirst({
            where: {
                name: { equals: normalized, mode: 'insensitive' },
                stateId
            },
        });

        if (record) {
            this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
            return record.id;
        }
        return null;
    }

    /**
     * Get or create State by name + countryId
     */
    async getOrCreateState(name: string, countryId: string): Promise<string | null> {
        if (!name || !countryId) return null;
        const normalized = name.trim();
        const cacheKey = this.getCacheKey(`state_${countryId}`);
        this.initCache(`state_${countryId}`);

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        let record = await this.prisma.state.findFirst({
            where: { name: { equals: normalized, mode: 'insensitive' }, countryId },
        });

        if (!record) {
            try {
                record = await this.prisma.state.create({ data: { name: normalized, countryId } });
            } catch {
                // handle race condition
                record = await this.prisma.state.findFirst({
                    where: { name: { equals: normalized, mode: 'insensitive' }, countryId },
                });
            }
        }

        if (record) {
            this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
            return record.id;
        }
        return null;
    }

    /**
     * Get or create City by name + stateId + countryId
     */
    async getOrCreateCity(name: string, stateId: string, countryId: string): Promise<string | null> {
        if (!name || !stateId || !countryId) return null;
        const normalized = name.trim();
        const cacheKey = this.getCacheKey(`city_${stateId}`);
        this.initCache(`city_${stateId}`);

        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        let record = await this.prisma.city.findFirst({
            where: { name: { equals: normalized, mode: 'insensitive' }, stateId },
        });

        if (!record) {
            try {
                record = await this.prisma.city.create({ data: { name: normalized, stateId, countryId } });
            } catch {
                // handle race condition
                record = await this.prisma.city.findFirst({
                    where: { name: { equals: normalized, mode: 'insensitive' }, stateId },
                });
            }
        }

        if (record) {
            this.cache[cacheKey].set(normalized.toLowerCase(), record.id);
            return record.id;
        }
        return null;
    }

    /**
     * Pre-warm only the HS code cache — used before validation.
     * Single query, loads all HS codes into memory so findHsCode() is a sync Map hit.
     */
    async warmHsCodeCache(): Promise<void> {
        const hsCodes = await this.prisma.hsCode.findMany({ select: { id: true, hsCode: true } });
        this.initCache('hscode');
        for (const h of hsCodes) {
            this.cache[this.getCacheKey('hscode')].set(h.hsCode.toLowerCase(), h.id);
        }
        this.logger.log(`HS code cache warmed: ${hsCodes.length} codes loaded`);
    }

    /**
     * Find HS Code by value
     */
    async findHsCode(hsCode: string): Promise<string | null> {
        if (!hsCode) return null;
        const normalized = hsCode.trim().toLowerCase();
        const cacheKey = this.getCacheKey('hscode');
        this.initCache('hscode');

        const cachedId = this.cache[cacheKey].get(normalized);
        if (cachedId) return cachedId;

        const record = await this.prisma.hsCode.findFirst({
            where: { hsCode: { equals: normalized, mode: 'insensitive' } },
        });

        if (record) {
            this.cache[cacheKey].set(normalized, record.id);
            return record.id;
        }
        return null;
    }

    /**
     * Get or create HS Code master record
     */
    async getOrCreateHsCode(hsCode: string): Promise<string | null> {
        if (!hsCode) return null;
        const normalized = hsCode.trim();
        const cacheKey = this.getCacheKey('hscode');
        this.initCache('hscode');

        // Check cache first
        const cachedId = this.cache[cacheKey].get(normalized.toLowerCase());
        if (cachedId) return cachedId;

        // Try to find or create
        return this.resolveOrCreate(
            'hscode', normalized, null,
            () => this.prisma.hsCode.findFirst({ where: { hsCode: { equals: normalized, mode: 'insensitive' } } }),
            () => this.prisma.hsCode.create({ data: { hsCode: normalized, status: 'active' } })
        );
    }

    /**
     * Pre-warm the cache by bulk-loading all existing master data in ~25 queries.
     * Call this once at the start of an import job — turns all subsequent
     * getOrCreate calls into sync cache hits with zero DB round trips.
     */
    async warmCache(): Promise<void> {
        this.logger.log('Pre-warming master data cache...');

        const [
            sizes, colors, brands, genders, departments,
            categories, itemClasses, silhouettes, channelClasses,
            seasons, segments, hsCodes, divisions, itemSubclasses,
            designations, grades, maritalStatus, employmentStatus,
            locations, whPolicies, leavesPolicies, allocations,
            subDepartments, countries, qualifications, institutes
        ] = await Promise.all([
            this.prisma.size.findMany({ select: { id: true, name: true } }),
            this.prisma.color.findMany({ select: { id: true, name: true } }),
            this.prisma.brand.findMany({ select: { id: true, name: true } }),
            this.prisma.gender.findMany({ select: { id: true, name: true } }),
            this.prisma.department.findMany({ select: { id: true, name: true } }),
            this.prisma.category.findMany({ select: { id: true, name: true, parentId: true } }),
            this.prisma.itemClass.findMany({ select: { id: true, name: true } }),
            this.prisma.silhouette.findMany({ select: { id: true, name: true } }),
            this.prisma.channelClass.findMany({ select: { id: true, name: true } }),
            this.prisma.season.findMany({ select: { id: true, name: true } }),
            this.prisma.segment.findMany({ select: { id: true, name: true } }),
            this.prisma.hsCode.findMany({ select: { id: true, hsCode: true } }),
            this.prisma.division.findMany({ select: { id: true, name: true, brandId: true } }),
            this.prisma.itemSubclass.findMany({ select: { id: true, name: true, itemClassId: true } }),
            // HR Masters
            this.prisma.designation.findMany({ select: { id: true, name: true } }),
            this.prisma.employeeGrade.findMany({ select: { id: true, grade: true } }),
            this.prisma.maritalStatus.findMany({ select: { id: true, name: true } }),
            this.prisma.employeeStatus.findMany({ select: { id: true, status: true } }),
            this.prisma.location.findMany({ select: { id: true, name: true } }),
            this.prisma.workingHoursPolicy.findMany({ select: { id: true, name: true } }),
            this.prisma.leavesPolicy.findMany({ select: { id: true, name: true } }),
            this.prisma.allocation.findMany({ select: { id: true, name: true } }),
            this.prisma.subDepartment.findMany({ select: { id: true, name: true, departmentId: true } }),
            this.prisma.country.findMany({ select: { id: true, name: true } }),
            this.prisma.qualification.findMany({ select: { id: true, name: true } }),
            this.prisma.institute.findMany({ select: { id: true, name: true } }),
        ]);

        const load = (type: string, records: { id: string; name?: string; grade?: string; status?: string }[]) => {
            this.initCache(type);
            for (const r of records) {
                const name = r.name || r.grade || r.status;
                if (name) this.cache[this.getCacheKey(type)].set(name.toLowerCase(), r.id);
            }
        };

        load('size', sizes);
        load('color', colors);
        load('brand', brands);
        load('gender', genders);
        load('department', departments);
        load('itemclass', itemClasses);
        load('silhouette', silhouettes);
        load('channelclass', channelClasses);
        load('season', seasons);
        load('segment', segments);

        // HR Masters
        load('designation', designations);
        load('employeegrade', grades);
        load('maritalstatus', maritalStatus);
        load('employmentstatus', employmentStatus);
        load('location', locations);
        load('workinghourspolicy', whPolicies);
        load('leavespolicy', leavesPolicies);
        load('allocation', allocations);
        load('country', countries);
        load('qualification', qualifications);
        load('institute', institutes);

        // Categories — keyed by name under their parentId bucket
        this.initCache('category');
        for (const c of categories) {
            const key = c.parentId ? this.getCacheKey(`category_${c.parentId}`) : this.getCacheKey('category');
            if (!this.cache[key]) this.cache[key] = new Map();
            this.cache[key].set(c.name.toLowerCase(), c.id);
        }

        // Sub-Departments — keyed per departmentId
        for (const s of subDepartments) {
            const key = this.getCacheKey(`subdepartment_${s.departmentId}`);
            if (!this.cache[key]) this.cache[key] = new Map();
            this.cache[key].set(s.name.toLowerCase(), s.id);
        }

        // HS Codes — field is hsCode not name
        this.initCache('hscode');
        for (const h of hsCodes) this.cache[this.getCacheKey('hscode')].set(h.hsCode.toLowerCase(), h.id);

        // Divisions — keyed per brandId
        for (const d of divisions) {
            const key = this.getCacheKey(`division_${d.brandId}`);
            if (!this.cache[key]) this.cache[key] = new Map();
            this.cache[key].set(d.name.toLowerCase(), d.id);
        }

        // Item Subclasses — keyed per itemClassId
        for (const s of itemSubclasses) {
            const key = this.getCacheKey(`itemsubclass_${s.itemClassId}`);
            if (!this.cache[key]) this.cache[key] = new Map();
            this.cache[key].set(s.name.toLowerCase(), s.id);
        }

        this.logger.log(`Cache warmed: ${sizes.length} sizes, ${colors.length} colors, ${brands.length} brands, ${departments.length} departments, ${designations.length} designations`);
    }

    /**
     * Clear cache (useful for testing or long-running processes)
     */
    clearCache(): void {
        this.cache = {};
        this.logger.log('Master data cache cleared');
    }
}

