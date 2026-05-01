import { Injectable } from '@nestjs/common';
import { PrismaMasterService } from '../database/prisma-master.service';

import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';
@Injectable()
export class UserPreferencesService {
  constructor(
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
  ) {}

  async get(userId: string, key: string) {
    try {
      const preference = await this.prismaMaster.userPreference.findUnique({
        where: {
          userId_key: {
            userId,
            key,
          },
        },
      });

      if (!preference) {
        return { status: true, data: null };
      }

      return { status: true, data: preference };
    } catch (error: any) {
      return { status: false, message: 'Failed to get user preference' };
    }
  }

  async upsert(userId: string, key: string, value: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const preference = await this.prismaMaster.userPreference.upsert({
        where: {
          userId_key: {
            userId,
            key,
          },
        },
        update: {
          value,
        },
        create: {
          userId,
          key,
          value,
        },
      });

      runInBackground(
        'Upsert User Preference',
        this.activityLogs.log({
          userId: ctx?.userId || userId,
          action: 'update',
          module: 'user-preferences',
          entity: 'UserPreference',
          entityId: preference.id,
          description: `Updated preference ${key} for user ${userId}`,
          newValues: JSON.stringify({ key, value }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return {
        status: true,
        data: preference,
        message: 'Preference saved successfully',
      };
    } catch (error: any) {
      runInBackground(
        'Upsert User Preference (Failure Log)',
        this.activityLogs.log({
          userId: ctx?.userId || userId,
          action: 'update',
          module: 'user-preferences',
          entity: 'UserPreference',
          description: `Failed to update preference ${key} for user ${userId}`,
          errorMessage: error?.message,
          newValues: JSON.stringify({ key, value }),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      return { status: false, message: 'Failed to save user preference' };
    }
  }
}
