import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { CreateTransferDto } from './dto/create-transfer.dto';

@Injectable()
export class TransferService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
  ) { }

  async create(createTransferDto: CreateTransferDto, userId: string) {
    const {
      employeeId,
      transferDate,
      newLocationId,
      newCityId,
      newStateId,
      reason,
    } = createTransferDto;

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    // Prepare update data
    const updateData: any = {};
    if (newLocationId) updateData.locationId = newLocationId;
    if (newCityId) updateData.cityId = newCityId;
    if (newStateId) updateData.stateId = newStateId;

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException(
        'At least one of Location, City, or State must be provided for transfer.',
      );
    }

    // Transaction to ensure atomicity
    return this.prisma.$transaction(async (tx) => {
      // 1. Create History Record
      const history = await tx.employeeTransferHistory.create({
        data: {
          employeeId,
          transferDate: new Date(transferDate),
          previousLocationId: employee.locationId,
          newLocationId: newLocationId || employee.locationId,
          previousCityId: employee.cityId,
          newCityId: newCityId || employee.cityId,
          previousStateId: employee.stateId,
          newStateId: newStateId || employee.stateId,
          reason,
          createdById: userId,
        },
      });

      // 2. Update Employee
      await tx.employee.update({
        where: { id: employeeId },
        data: updateData,
      });

      return history;
    });
  }

  async findAll(employeeId: string) {
    const transfers = await this.prisma.employeeTransferHistory.findMany({
      where: { employeeId },
      orderBy: {
        transferDate: 'desc',
      },
    });

    if (transfers.length === 0) return [];

    // Collect all IDs for Master Data fetching
    const locationIds = [
      ...new Set(
        [
          ...transfers.map((t) => t.previousLocationId),
          ...transfers.map((t) => t.newLocationId),
        ].filter(Boolean) as string[],
      ),
    ];

    const cityIds = [
      ...new Set(
        [
          ...transfers.map((t) => t.previousCityId),
          ...transfers.map((t) => t.newCityId),
        ].filter(Boolean) as string[],
      ),
    ];

    const stateIds = [
      ...new Set(
        [
          ...transfers.map((t) => t.previousStateId),
          ...transfers.map((t) => t.newStateId),
        ].filter(Boolean) as string[],
      ),
    ];

    const userIds = [
      ...new Set(
        transfers.map((t) => t.createdById).filter(Boolean) as string[],
      ),
    ];

    // Fetch Master Data in parallel
    const [locations, cities, states, users] = await Promise.all([
      this.prisma.location.findMany({
        where: { id: { in: locationIds } },
      }),
      this.prisma.city.findMany({ where: { id: { in: cityIds } } }),
      this.prisma.state.findMany({ where: { id: { in: stateIds } } }),
      this.prismaMaster.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, firstName: true, lastName: true },
      }),
    ]);

    // Create lookup maps
    const locationMap = new Map(locations.map((l) => [l.id, l]));
    const cityMap = new Map(cities.map((c) => [c.id, c]));
    const stateMap = new Map(states.map((s) => [s.id, s]));
    const userMap = new Map(users.map((u) => [u.id, u]));

    // Augment transfer records with master data
    return transfers.map((t) => ({
      ...t,
      previousLocation: t.previousLocationId
        ? locationMap.get(t.previousLocationId)
        : null,
      newLocation: t.newLocationId ? locationMap.get(t.newLocationId) : null,
      previousCity: t.previousCityId ? cityMap.get(t.previousCityId) : null,
      newCity: t.newCityId ? cityMap.get(t.newCityId) : null,
      previousState: t.previousStateId ? stateMap.get(t.previousStateId) : null,
      newState: t.newStateId ? stateMap.get(t.newStateId) : null,
      createdBy: t.createdById ? userMap.get(t.createdById) : null,
    }));
  }
}
