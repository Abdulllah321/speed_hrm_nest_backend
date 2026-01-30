import { PrismaService as NewPrismaService } from '../database/prisma.service';

/**
 * @deprecated Use PrismaService from DatabaseModule instead.
 * This proxy is maintained to avoid immediate breakage of legacy services.
 */
export const PrismaService = NewPrismaService;
export type PrismaService = NewPrismaService;
