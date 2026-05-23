import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Inject,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { PrismaMasterService } from '../../database/prisma-master.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prismaMaster: PrismaMasterService,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();
    if (!user) {
      return false;
    }

    // Fast path: JwtAuthGuard already resolved permissions onto req.user
    if (Array.isArray(user.permissions)) {
      if (user.permissions.includes('*')) return true;
      return requiredPermissions.some((p) => user.permissions.includes(p));
    }

    // Fallback: resolve from DB via userId or roleId (legacy path)
    const userId = user.id || user.userId;
    let userPermissions: string[] = [];

    if (userId) {
      userPermissions = await this.resolveUserPermissions(userId);
    } else if (user.roleId) {
      userPermissions = await this.getUserPermissions(user.roleId);
    } else {
      return false;
    }

    if (userPermissions.includes('*')) {
      return true;
    }

    return requiredPermissions.some((permission) =>
      userPermissions.includes(permission),
    );
  }

  private async resolveUserPermissions(userId: string): Promise<string[]> {
    const user = await this.prismaMaster.user.findUnique({
      where: { id: userId },
      select: {
        roleId: true,
        roleExpiresAt: true,
        role: {
          select: {
            name: true,
            permissions: {
              select: {
                permission: { select: { name: true } },
              },
            },
          },
        },
        userPermissions: {
          where: {
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: new Date() } }
            ]
          },
          select: {
            isAllowed: true,
            permission: { select: { name: true } },
          },
        },
      },
    });

    if (!user) return [];

    const permissionsSet = new Set<string>();
    const roleName = user.role?.name?.toLowerCase();

    // Check if role is active and not expired
    const isRoleActive = user.roleId && user.role && (!user.roleExpiresAt || user.roleExpiresAt > new Date());

    if (isRoleActive && user.role) {
      if (roleName === 'super_admin' || roleName === 'admin') {
        permissionsSet.add('*');
      } else {
        user.role.permissions.forEach((rp) => {
          if (rp.permission?.name) {
            permissionsSet.add(rp.permission.name);
          }
        });
      }
    }

    // Process direct user overrides (allow/deny)
    if (user.userPermissions) {
      user.userPermissions.forEach((up) => {
        if (up.permission?.name) {
          if (up.isAllowed) {
            permissionsSet.add(up.permission.name);
          } else {
            permissionsSet.delete(up.permission.name);
          }
        }
      });
    }

    return Array.from(permissionsSet);
  }

  private async getUserPermissions(roleId: string): Promise<string[]> {
    const cacheKey = `permissions_v2_role_${roleId}`;
    const cached = await this.cacheManager.get<string[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const role = await this.prismaMaster.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!role) {
      return [];
    }

    // Super Admin and Admin bypass
    const name = role.name.toLowerCase();
    if (name === 'super_admin' || name === 'admin') {
      const allPermissions = ['*'];
      await this.cacheManager.set(cacheKey, allPermissions, 3600000);
      return allPermissions;
    }

    const permissions = role.permissions.map((p) => p.permission.name);
    // Cache for 1 hour
    await this.cacheManager.set(cacheKey, permissions, 3600000);

    return permissions;
  }
}
