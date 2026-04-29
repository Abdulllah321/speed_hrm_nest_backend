import { Injectable } from '@nestjs/common';
import { PrismaMasterService } from '../database/prisma-master.service';

import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';
@Injectable()
export class PermissionService {
  constructor(private prisma: PrismaMasterService,
    private activityLogs: ActivityLogsService,
  ) {}

  async findAll() {
    return this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
  }
}
