import { Injectable, Inject } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import * as cacheManager_1 from 'cache-manager';

export interface SearchResult {
  type: 'Employee' | 'Item' | 'Supplier' | 'RFQ';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

@Injectable()
export class SearchService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CACHE_MANAGER) private cacheManager: cacheManager_1.Cache,
  ) {}

  async globalSearch(query: string): Promise<SearchResult[]> {
    const cacheKey = `global_search:${query.toLowerCase()}`;
    const cachedResults = await this.cacheManager.get<SearchResult[]>(cacheKey);

    if (cachedResults) {
      return cachedResults;
    }

    const results: SearchResult[] = [];

    // Parallel search across different entities
    const [employees, items, suppliers, rfqs] = await Promise.all([
      this.searchEmployees(query),
      this.searchItems(query),
      this.searchSuppliers(query),
      this.searchRFQs(query),
    ]);

    results.push(...employees, ...items, ...suppliers, ...rfqs);

    // Cache results for 5 minutes
    await this.cacheManager.set(cacheKey, results, 300000);

    return results;
  }

  private async searchEmployees(query: string): Promise<SearchResult[]> {
    const employees = await this.prisma.employee.findMany({
      where: {
        OR: [
          { employeeName: { contains: query, mode: 'insensitive' } },
          { employeeId: { contains: query, mode: 'insensitive' } },
          { cnicNumber: { contains: query, mode: 'insensitive' } },
          { officialEmail: { contains: query, mode: 'insensitive' } },
        ],
        status: 'active',
      },
      take: 5,
    });

    return employees.map((e) => ({
      type: 'Employee',
      id: e.id,
      title: e.employeeName,
      subtitle: `ID: ${e.employeeId} | ${e.officialEmail || ''}`,
      href: `/hr/employee/view/${e.id}`,
    }));
  }

  private async searchItems(query: string): Promise<SearchResult[]> {
    const items = await this.prisma.item.findMany({
      where: {
        OR: [
          { sku: { contains: query, mode: 'insensitive' } },
          { itemId: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
        status: 'active',
      },
      take: 5,
    });

    return items.map((i) => ({
      type: 'Item',
      id: i.id,
      title: i.sku,
      subtitle: i.description || i.itemId,
      href: `/inventory/items/${i.id}`, // Adjusted based on common patterns
    }));
  }

  private async searchSuppliers(query: string): Promise<SearchResult[]> {
    const suppliers = await this.prisma.supplier.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { code: { contains: query, mode: 'insensitive' } },
          { email: { contains: query, mode: 'insensitive' } },
        ],
        isActive: true,
      },
      take: 5,
    });

    return suppliers.map((s) => ({
      type: 'Supplier',
      id: s.id,
      title: s.name,
      subtitle: `Code: ${s.code}`,
      href: `/procurement/suppliers/${s.id}`, // Adjusted based on common patterns
    }));
  }

  private async searchRFQs(query: string): Promise<SearchResult[]> {
    const rfqs = await this.prisma.requestForQuotation.findMany({
      where: {
        rfqNumber: { contains: query, mode: 'insensitive' },
      },
      take: 5,
    });

    return rfqs.map((r) => ({
      type: 'RFQ',
      id: r.id,
      title: r.rfqNumber,
      subtitle: `Date: ${new Date(r.rfqDate).toLocaleDateString()}`,
      href: `/procurement/rfq/${r.id}`,
    }));
  }
}
