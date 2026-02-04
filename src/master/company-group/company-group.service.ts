import { Injectable } from '@nestjs/common';
import { PrismaMasterService } from '../../database/prisma-master.service';
import { CreateCompanyGroupDto, UpdateCompanyGroupDto } from './dto/company-group-dto';

@Injectable()
export class CompanyGroupService {
  constructor(private prisma: PrismaMasterService) { }

  async create(createDto: CreateCompanyGroupDto, userId: string) {
    const result = await this.prisma.companyGroup.create({
      data: {
        ...createDto,
        createdById: userId,
      },
    });
    return { status: true, data: result, message: 'Company Group created successfully' };
  }

  async findAll() {
    const data = await this.prisma.companyGroup.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return { status: true, data };
  }

  async findOne(id: string) {
    const data = await this.prisma.companyGroup.findUnique({
      where: { id },
    });
    return { status: true, data };
  }

  async update(id: string, updateDto: UpdateCompanyGroupDto) {
    const result = await this.prisma.companyGroup.update({
      where: { id },
      data: updateDto,
    });
    return { status: true, data: result, message: 'Company Group updated successfully' };
  }

  async remove(id: string) {
    await this.prisma.companyGroup.delete({
      where: { id },
    });
    return { status: true, message: 'Company Group deleted successfully' };
  }
}
