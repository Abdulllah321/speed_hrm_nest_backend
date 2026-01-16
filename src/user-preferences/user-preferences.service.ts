import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserPreferencesService {
  constructor(private prisma: PrismaService) {}

  async get(userId: string, key: string) {
    try {
      const preference = await this.prisma.userPreference.findUnique({
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

  async upsert(userId: string, key: string, value: string) {
    try {
      const preference = await this.prisma.userPreference.upsert({
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

      return {
        status: true,
        data: preference,
        message: 'Preference saved successfully',
      };
    } catch (error: any) {
      return { status: false, message: 'Failed to save user preference' };
    }
  }
}
