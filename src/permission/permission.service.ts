import { Injectable } from '@nestjs/common';
import { PrismaMasterService } from 'src/database/prisma-master.service';

@Injectable()
export class PermissionService {
  constructor(private prisma: PrismaMasterService) {}

  async findAll() {
    return this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
  }
}
