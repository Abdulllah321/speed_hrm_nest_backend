import { Injectable, CanActivate, ExecutionContext, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class FiscalPeriodGuard implements CanActivate {
  private readonly logger = new Logger(FiscalPeriodGuard.name);

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const body = request.body || {};
    const query = request.query || {};

    // Extract target date from payload (postingDate, createdAt, date, asOfDate, etc.)
    const rawDate = body.postingDate || body.date || body.createdAt || query.date || query.postingDate;
    if (!rawDate) {
      return true; // No explicit date parameter provided, request is valid
    }

    const targetDate = new Date(rawDate);
    if (isNaN(targetDate.getTime())) {
      return true;
    }

    try {
      const prisma: PrismaService = request.prisma || PrismaService.getTenantClient(request.user?.tenantId, request.user?.tenantDbUrl);

      // Check if targetDate falls within any closed FiscalPeriod
      const closedPeriod = await prisma.fiscalPeriod.findFirst({
        where: {
          isClosed: true,
          startDate: { lte: targetDate },
          endDate: { gte: targetDate },
        },
      });

      if (closedPeriod) {
        this.logger.warn(`Blocked posting into closed fiscal period "${closedPeriod.name}" for date ${targetDate.toISOString()}`);
        throw new BadRequestException(
          `Cannot create or edit transactions for date ${targetDate.toISOString().split('T')[0]}. Fiscal Period "${closedPeriod.name}" is closed and locked.`,
        );
      }
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`FiscalPeriodGuard check warning: ${err.message}`);
    }

    return true;
  }
}
