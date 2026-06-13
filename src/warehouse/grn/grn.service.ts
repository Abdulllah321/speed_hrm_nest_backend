import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateGrnDto } from './dto/grn.dto';
import { MovementType, Prisma } from '@prisma/client';
import { StockLedgerService } from '../stock-ledger/stock-ledger.service';
import { PrismaMasterService } from '../../database/prisma-master.service';

import { ActivityLogsService } from '../../activity-logs/activity-logs.service';
import { runInBackground } from '../../common/utils/run-in-background.util';
@Injectable()
export class GrnService {
  private readonly logger = new Logger(GrnService.name);

  constructor(
    private prisma: PrismaService,
    private stockLedgerService: StockLedgerService,
    private activityLogs: ActivityLogsService,
    private prismaMaster: PrismaMasterService,
  ) {}

  /**
   * Generates the next sequential GRN number for the current fiscal year.
   * Fiscal year runs July 1 – June 30 (Pakistan standard).
   * Format: GRN-YY-YY-NNNNN  e.g. GRN-25-26-00001
   *
   * @param tx  Optional Prisma transaction client (use when called inside $transaction)
   */
  private async generateGrnNumber(tx?: any): Promise<string> {
    const client = tx || this.prisma;

    // Determine current fiscal year bounds
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed; July = 6
    const startYear = month >= 6 ? year : year - 1;
    const endYear = startYear + 1;
    const fy = `${String(startYear % 100).padStart(2, '0')}-${String(endYear % 100).padStart(2, '0')}`;
    const prefix = `GRN-${fy}-`;

    // Find the last GRN issued in this fiscal year
    const fiscalYearStartDate = new Date(Date.UTC(startYear, 6, 1, 0, 0, 0, 0));
    const lastGrn = await client.goodsReceiptNote.findFirst({
      where: {
        grnNumber: { startsWith: prefix },
        createdAt: { gte: fiscalYearStartDate },
      },
      orderBy: { createdAt: 'desc' },
      select: { grnNumber: true },
    });

    let seq = 1;
    if (lastGrn?.grnNumber) {
      const parts = lastGrn.grnNumber.split('-');
      const lastSeq = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastSeq)) {
        seq = lastSeq + 1;
      }
    }

    // Collision guard — loop until we find an unused number
    let grnNumber = `${prefix}${String(seq).padStart(5, '0')}`;
    let exists = await client.goodsReceiptNote.findUnique({
      where: { grnNumber },
      select: { id: true },
    });
    while (exists) {
      seq++;
      grnNumber = `${prefix}${String(seq).padStart(5, '0')}`;
      exists = await client.goodsReceiptNote.findUnique({
        where: { grnNumber },
        select: { id: true },
      });
    }

    return grnNumber;
  }

  private async calculateAndApplyWeightedAverage(
    tx: Prisma.TransactionClient,
    itemId: string,
    warehouseId: string,
    incomingQty: Prisma.Decimal,
    incomingRate: Prisma.Decimal,
  ): Promise<Prisma.Decimal> {
    const currentStock = await tx.inventoryItem.aggregate({
      where: {
        itemId,
        warehouseId,
        locationId: null,
        status: 'AVAILABLE',
      },
      _sum: {
        quantity: true,
      },
    });

    const oldQty = currentStock._sum.quantity || new Prisma.Decimal(0);
    const item = await tx.item.findUnique({
      where: { id: itemId },
      select: { unitCost: true },
    });
    const oldAvg = new Prisma.Decimal(item?.unitCost || 0);

    const totalQty = oldQty.plus(incomingQty);
    const weightedAvg = totalQty.gt(0)
      ? oldQty.mul(oldAvg).plus(incomingQty.mul(incomingRate)).div(totalQty)
      : incomingRate;

    await tx.item.update({
      where: { id: itemId },
      data: { unitCost: weightedAvg.toNumber() },
    });

    await tx.tenantItemSetting.upsert({
      where: { itemId },
      create: {
        itemId,
        averageCost: weightedAvg,
      },
      update: {
        averageCost: weightedAvg,
      },
    });

    return weightedAvg;
  }

  async findAll() {
    const grns = await this.prisma.goodsReceiptNote.findMany({
      include: {
        items: {
          include: {
            item: {
              include: {
                hsCode: true,
                category: { select: { name: true } },
              },
            },
          },
        },
        purchaseOrder: {
          select: {
            poNumber: true,
            vendorId: true,
            purchaseRequisitionId: true,
            vendorQuotationId: true,
            rfqId: true,
            goodsType: true,
            orderType: true,
            items: true,
            vendor: {
              select: { id: true, name: true, code: true },
            },
            purchaseRequisition: {
              select: { goodsType: true },
            },
          },
        },
        warehouse: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return this.resolveUserNamesForList(grns);
  }

  async findOne(id: string) {
    const grn = await this.prisma.goodsReceiptNote.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            item: {
              include: {
                size: true,
                color: true,
              },
            },
          },
        },
        purchaseOrder: true,
        warehouse: true,
      },
    });

    if (!grn) {
      throw new NotFoundException('GRN not found');
    }

    return this.resolveUserNames(grn);
  }

  async create(
    dto: CreateGrnDto,
    ctx?: { userId?: string; ipAddress?: string; userAgent?: string },
  ) {
    this.logger.log(`Starting GRN creation for PO: ${dto.purchaseOrderId}`);
    this.logger.debug(`GRN DTO: ${JSON.stringify(dto)}`);

    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: dto.purchaseOrderId },
      include: {
        items: true,
        vendorQuotation: true,
        purchaseRequisition: true,
      },
    });

    if (!po) {
      this.logger.error(`Purchase Order not found: ${dto.purchaseOrderId}`);
      throw new NotFoundException('Purchase Order not found');
    }

    this.logger.log(`Found PO: ${po.poNumber}, Status: ${po.status}`);

    if (po.status !== 'OPEN' && po.status !== 'PARTIALLY_RECEIVED') {
      this.logger.error(`Cannot receive goods for PO in ${po.status} status`);
      throw new BadRequestException(
        `Cannot receive goods for PO in ${po.status} status`,
      );
    }

    const grnNumber = await this.generateGrnNumber();
    this.logger.log(`Generated GRN Number: ${grnNumber}`);

    // Resolve items to UUIDs and validate quantities
    const resolvedItems = await Promise.all(
      dto.items.map(async (item) => {
        const itemRecord = await this.prisma.item.findFirst({
          where: {
            OR: [{ id: item.itemId }, { itemId: item.itemId }],
          },
          select: { id: true },
        });

        if (!itemRecord) {
          throw new BadRequestException(
            `Item with ID or code ${item.itemId} not found in database master`,
          );
        }

        const poItem = po.items.find(
          (i) => i.itemId === itemRecord.id || i.id === itemRecord.id,
        );
        if (!poItem) {
          throw new BadRequestException(`Item ${item.itemId} not found in PO`);
        }

        const remainingQty = new Prisma.Decimal(poItem.quantity).minus(
          new Prisma.Decimal(poItem.receivedQty || 0),
        );

        if (new Prisma.Decimal(item.receivedQty).gt(remainingQty)) {
          throw new BadRequestException(
            `Received quantity ${item.receivedQty} exceeds remaining quantity ${remainingQty} for item ${item.itemId}`,
          );
        }

        return {
          ...item,
          itemId: itemRecord.id, // Use the proper UUID
        };
      }),
    );

    // Create GRN with PENDING_CHECKER status
    const grn = await this.prisma.goodsReceiptNote.create({
      data: {
        grnNumber,
        purchaseOrderId: dto.purchaseOrderId,
        warehouseId: dto.warehouseId,
        status: 'PENDING_CHECKER',
        notes: dto.notes,
        orderType: po.orderType || null,
        goodsType: po.goodsType || po.purchaseRequisition?.goodsType || null,
        createdById: ctx?.userId,
        items: {
          create: resolvedItems.map((item) => ({
            itemId: item.itemId,
            description: item.description,
            receivedQty: new Prisma.Decimal(item.receivedQty),
          })),
        },
      },
      include: { items: true },
    });

    runInBackground(
      'Create GRN (Maker)',
      this.activityLogs.log({
        userId: ctx?.userId,
        action: 'create',
        module: 'warehouse-grn',
        entity: 'GoodsReceiptNote',
        entityId: grn.id,
        description: `Created GRN ${grn.grnNumber} (PENDING_CHECKER) for PO ${dto.purchaseOrderId}`,
        newValues: JSON.stringify(dto),
        ipAddress: ctx?.ipAddress,
        userAgent: ctx?.userAgent,
        status: 'success',
      }),
    );

    return grn;
  }

  async updateStatus(
    id: string,
    targetStatus: string,
    ctx: {
      userId: string;
      permissions: string[];
      roleName: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ) {
    this.logger.log(`Updating GRN ${id} status to ${targetStatus}`);

    const grn = await this.prisma.goodsReceiptNote.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!grn) {
      throw new NotFoundException('GRN not found');
    }

    const currentStatus = grn.status;
    const isSuperAdmin =
      ctx.permissions.includes('*') ||
      ctx?.roleName?.toLowerCase() === 'super_admin' ||
      ctx?.roleName?.toLowerCase() === 'admin';
    const isChecker =
      ctx.permissions.includes('erp.procurement.grn.check') ||
      ctx.permissions.includes('*') ||
      isSuperAdmin;
    const isAuthorizer =
      ctx.permissions.includes('erp.procurement.grn.authorize') ||
      ctx.permissions.includes('*') ||
      isSuperAdmin;

    if (currentStatus === 'PENDING_CHECKER') {
      if (!isChecker) {
        throw new BadRequestException(
          'User does not have permission to check/verify this GRN.',
        );
      }
      if (
        targetStatus !== 'PENDING_AUTHORIZER' &&
        targetStatus !== 'REJECTED'
      ) {
        throw new BadRequestException(
          `Invalid status transition from PENDING_CHECKER to ${targetStatus}`,
        );
      }

      const updatedGrn = await this.prisma.goodsReceiptNote.update({
        where: { id },
        data: {
          status: targetStatus,
          checkedById: ctx.userId,
          checkedAt: new Date(),
        },
      });

      runInBackground(
        'Check GRN',
        this.activityLogs.log({
          userId: ctx.userId,
          action: 'update',
          module: 'warehouse-grn',
          entity: 'GoodsReceiptNote',
          entityId: id,
          description: `Checked GRN ${grn.grnNumber}: targetStatus ${targetStatus}`,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          status: 'success',
        }),
      );

      return updatedGrn;
    }

    if (currentStatus === 'PENDING_AUTHORIZER') {
      if (!isAuthorizer) {
        throw new BadRequestException(
          'User does not have permission to authorize this GRN.',
        );
      }
      if (targetStatus !== 'APPROVED' && targetStatus !== 'REJECTED') {
        throw new BadRequestException(
          `Invalid status transition from PENDING_AUTHORIZER to ${targetStatus}`,
        );
      }

      if (targetStatus === 'REJECTED') {
        const updatedGrn = await this.prisma.goodsReceiptNote.update({
          where: { id },
          data: {
            status: 'REJECTED',
            authorizedById: ctx.userId,
            authorizedAt: new Date(),
          },
        });

        runInBackground(
          'Reject GRN',
          this.activityLogs.log({
            userId: ctx.userId,
            action: 'update',
            module: 'warehouse-grn',
            entity: 'GoodsReceiptNote',
            entityId: id,
            description: `Rejected GRN ${grn.grnNumber} by Authorizer`,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            status: 'success',
          }),
        );

        return updatedGrn;
      }

      // If approved (targetStatus === 'APPROVED'), run the full transaction to update stock and PO
      return this.prisma.$transaction(async (tx) => {
        // Fetch PO
        const po = await tx.purchaseOrder.findUnique({
          where: { id: grn.purchaseOrderId },
          include: { items: true, purchaseRequisition: true },
        });

        if (!po) {
          throw new NotFoundException('Purchase Order not found');
        }

        if (po.status !== 'OPEN' && po.status !== 'PARTIALLY_RECEIVED') {
          throw new BadRequestException(
            `Cannot receive goods for PO in ${po.status} status`,
          );
        }

        // Determine stock update properties
        const isRfqVqFlow = Boolean(po.vendorQuotationId || po.rfqId);
        const isPrDirectFlow = Boolean(
          po.purchaseRequisitionId && !po.vendorQuotationId && !po.rfqId,
        );
        const isDirectPoFlow = Boolean(
          !po.purchaseRequisitionId && !po.vendorQuotationId && !po.rfqId,
        );

        let shouldUpdateInventory = false;
        let finalGrnStatus = 'RECEIVED_UNVALUED';

        if (isDirectPoFlow) {
          shouldUpdateInventory = false;
          finalGrnStatus = 'RECEIVED_UNVALUED';
        } else if (isRfqVqFlow || isPrDirectFlow) {
          const prGoodsType = po.goodsType || po.purchaseRequisition?.goodsType;
          const isConsumable = prGoodsType === 'CONSUMABLE' || !prGoodsType;
          if (isConsumable) {
            shouldUpdateInventory = true;
            finalGrnStatus = 'VALUED';
          } else {
            shouldUpdateInventory = false;
            finalGrnStatus = 'RECEIVED_UNVALUED';
          }
        }

        // Process items
        for (const grnItem of grn.items) {
          const poItem = po.items.find(
            (i) => i.itemId === grnItem.itemId || i.id === grnItem.itemId,
          );
          if (!poItem) {
            throw new BadRequestException(
              `Item ${grnItem.itemId} not found in PO`,
            );
          }

          const remainingQty = new Prisma.Decimal(poItem.quantity).minus(
            new Prisma.Decimal(poItem.receivedQty),
          );

          if (new Prisma.Decimal(grnItem.receivedQty).gt(remainingQty)) {
            throw new BadRequestException(
              `Received quantity for item ${grnItem.itemId} exceeds remaining quantity. Remaining: ${remainingQty}`,
            );
          }

          // Update PO item receivedQty
          await tx.purchaseOrderItem.update({
            where: { id: poItem.id },
            data: {
              receivedQty: {
                increment: new Prisma.Decimal(grnItem.receivedQty),
              },
            },
          });

          // Stock update if consumable
          if (shouldUpdateInventory) {
            const incomingRate = poItem.unitPrice
              ? new Prisma.Decimal(poItem.unitPrice)
              : new Prisma.Decimal(0);
            const weightedAvgRate = await this.calculateAndApplyWeightedAverage(
              tx,
              grnItem.itemId,
              grn.warehouseId,
              new Prisma.Decimal(grnItem.receivedQty),
              incomingRate,
            );

            await this.stockLedgerService.createEntry(
              {
                itemId: grnItem.itemId,
                warehouseId: grn.warehouseId,
                qty: Number(grnItem.receivedQty),
                movementType: MovementType.INBOUND,
                referenceType: 'GRN',
                referenceId: grn.id,
                rate: weightedAvgRate,
              },
              tx,
            );

            const existingStock = await tx.inventoryItem.findFirst({
              where: {
                warehouseId: grn.warehouseId,
                locationId: null,
                itemId: grnItem.itemId,
                status: 'AVAILABLE',
              },
            });

            if (existingStock) {
              await tx.inventoryItem.update({
                where: { id: existingStock.id },
                data: {
                  quantity: {
                    increment: new Prisma.Decimal(grnItem.receivedQty),
                  },
                },
              });
            } else {
              await tx.inventoryItem.create({
                data: {
                  warehouseId: grn.warehouseId,
                  locationId: null,
                  itemId: grnItem.itemId,
                  quantity: new Prisma.Decimal(grnItem.receivedQty),
                  status: 'AVAILABLE',
                },
              });
            }
          }
        }

        // Fetch updated PO state to determine correct overall PO status
        const updatedPo = await tx.purchaseOrder.findUnique({
          where: { id: grn.purchaseOrderId },
          include: { items: true },
        });

        if (!updatedPo) {
          throw new BadRequestException(
            'Failed to retrieve updated Purchase Order',
          );
        }

        const allReceived = updatedPo.items.every((item) =>
          new Prisma.Decimal(item.receivedQty).gte(
            new Prisma.Decimal(item.quantity),
          ),
        );

        let poStatus = 'PARTIALLY_RECEIVED';
        if (allReceived) {
          poStatus = shouldUpdateInventory ? 'CLOSED' : 'RECEIVED';
        }

        await tx.purchaseOrder.update({
          where: { id: grn.purchaseOrderId },
          data: { status: poStatus },
        });

        // Update GRN status to authorized
        const updatedGrn = await tx.goodsReceiptNote.update({
          where: { id },
          data: {
            status: finalGrnStatus,
            authorizedById: ctx.userId,
            authorizedAt: new Date(),
          },
        });

        runInBackground(
          'Authorize GRN',
          this.activityLogs.log({
            userId: ctx.userId,
            action: 'update',
            module: 'warehouse-grn',
            entity: 'GoodsReceiptNote',
            entityId: id,
            description: `Authorized GRN ${grn.grnNumber} by Authorizer. Final Status: ${finalGrnStatus}`,
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            status: 'success',
          }),
        );

        return updatedGrn;
      });
    }

    throw new BadRequestException(
      `Cannot update status from ${currentStatus} to ${targetStatus}`,
    );
  }

  private async resolveUserNames(grn: any) {
    if (!grn) return grn;
    const userIds = [
      grn.createdById,
      grn.checkedById,
      grn.authorizedById,
    ].filter(Boolean) as string[];
    if (userIds.length === 0) return grn;

    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true },
    });

    const userMap = new Map(
      users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]),
    );

    return {
      ...grn,
      creatorName: grn.createdById
        ? userMap.get(grn.createdById) || 'Unknown User'
        : null,
      checkerName: grn.checkedById
        ? userMap.get(grn.checkedById) || 'Unknown User'
        : null,
      authorizerName: grn.authorizedById
        ? userMap.get(grn.authorizedById) || 'Unknown User'
        : null,
    };
  }

  private async resolveUserNamesForList(grns: any[]) {
    if (!grns || grns.length === 0) return grns;
    const userIdsSet = new Set<string>();
    grns.forEach((grn) => {
      if (grn.createdById) userIdsSet.add(grn.createdById);
      if (grn.checkedById) userIdsSet.add(grn.checkedById);
      if (grn.authorizedById) userIdsSet.add(grn.authorizedById);
    });
    const userIds = Array.from(userIdsSet);
    if (userIds.length === 0) return grns;

    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true },
    });

    const userMap = new Map(
      users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]),
    );

    return grns.map((grn) => ({
      ...grn,
      creatorName: grn.createdById
        ? userMap.get(grn.createdById) || 'Unknown User'
        : null,
      checkerName: grn.checkedById
        ? userMap.get(grn.checkedById) || 'Unknown User'
        : null,
      authorizerName: grn.authorizedById
        ? userMap.get(grn.authorizedById) || 'Unknown User'
        : null,
    }));
  }
}
