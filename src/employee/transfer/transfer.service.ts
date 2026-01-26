import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTransferDto } from './dto/create-transfer.dto';

@Injectable()
export class TransferService {
    constructor(private prisma: PrismaService) { }

    async create(createTransferDto: CreateTransferDto, userId: string) {
        const { employeeId, transferDate, newLocationId, newCityId, newStateId, reason } = createTransferDto;

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
            throw new BadRequestException('At least one of Location, City, or State must be provided for transfer.');
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
        return this.prisma.employeeTransferHistory.findMany({
            where: { employeeId },
            include: {
                previousLocation: true,
                newLocation: true,
                previousCity: true,
                newCity: true,
                previousState: true,
                newState: true,
                createdBy: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                    }
                }
            },
            orderBy: {
                transferDate: 'desc',
            },
        });
    }
}
