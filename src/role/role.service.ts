import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PrismaMasterService } from '../database/prisma-master.service';

import { ActivityLogsService } from '../activity-logs/activity-logs.service';
import { runInBackground } from '../common/utils/run-in-background.util';

@Injectable()
export class RoleService {
  constructor(
    private prismaMaster: PrismaMasterService,
    private activityLogs: ActivityLogsService,
  ) {}

  async create(createRoleDto: CreateRoleDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const existing = await this.prismaMaster.role.findUnique({
        where: { name: createRoleDto.name },
      });

      if (existing) {
        throw new ConflictException('Role with this name already exists');
      }

      const { permissionIds, ...data } = createRoleDto;

      const role = await this.prismaMaster.role.create({
        data: {
          ...data,
          permissions: permissionIds?.length
            ? {
                create: permissionIds.map((id) => ({
                  permission: { connect: { id } },
                })),
              }
            : undefined,
        },
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      });

      runInBackground(
        'Create Role',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'roles',
          entity: 'Role',
          entityId: role.id,
          description: `Created role ${role.name}`,
          newValues: JSON.stringify(createRoleDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return role;
    } catch (error: any) {
      runInBackground(
        'Create Role (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'create',
          module: 'roles',
          entity: 'Role',
          description: `Failed to create role ${createRoleDto.name}`,
          errorMessage: error?.message,
          newValues: JSON.stringify(createRoleDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async findAll() {
    return this.prismaMaster.role.findMany({
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
        _count: {
          select: { users: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const role = await this.prismaMaster.role.findUnique({
      where: { id },
      include: {
        permissions: {
          include: {
            permission: true,
          },
        },
      },
    });

    if (!role) {
      throw new NotFoundException('Role not found');
    }

    return role;
  }

  async update(id: string, updateRoleDto: UpdateRoleDto, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const role = await this.prismaMaster.role.findUnique({ where: { id } });
      if (!role) {
        throw new NotFoundException('Role not found');
      }

      const { permissionIds, ...data } = updateRoleDto;

      // If permissions are being updated
      if (permissionIds) {
        // First delete existing permissions
        await this.prismaMaster.rolePermission.deleteMany({
          where: { roleId: id },
        });
      }

      const updatedRole = await this.prismaMaster.role.update({
        where: { id },
        data: {
          ...data,
          permissions: permissionIds
            ? {
                create: permissionIds.map((pid) => ({
                  permission: { connect: { id: pid } },
                })),
              }
            : undefined,
        },
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      });

      runInBackground(
        'Update Role',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'roles',
          entity: 'Role',
          entityId: id,
          description: `Updated role ${updatedRole.name}`,
          oldValues: JSON.stringify(role),
          newValues: JSON.stringify(updateRoleDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return updatedRole;
    } catch (error: any) {
      runInBackground(
        'Update Role (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'update',
          module: 'roles',
          entity: 'Role',
          entityId: id,
          description: `Failed to update role ${id}`,
          errorMessage: error?.message,
          newValues: JSON.stringify(updateRoleDto),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }

  async remove(id: string, ctx?: { userId?: string; ipAddress?: string; userAgent?: string }) {
    try {
      const role = await this.prismaMaster.role.findUnique({
        where: { id },
        include: { _count: { select: { users: true } } },
      });

      if (!role) {
        throw new NotFoundException('Role not found');
      }

      if (role.isSystem) {
        throw new ConflictException('Cannot delete system role');
      }

      if (role._count.users > 0) {
        throw new ConflictException('Cannot delete role assigned to users');
      }

      const deletedRole = await this.prismaMaster.role.delete({
        where: { id },
      });

      runInBackground(
        'Delete Role',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'roles',
          entity: 'Role',
          entityId: id,
          description: `Deleted role ${deletedRole.name}`,
          oldValues: JSON.stringify(role),
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'success',
        }),
      );

      return deletedRole;
    } catch (error: any) {
      runInBackground(
        'Delete Role (Failure)',
        this.activityLogs.log({
          userId: ctx?.userId,
          action: 'delete',
          module: 'roles',
          entity: 'Role',
          entityId: id,
          description: `Failed to delete role ${id}`,
          errorMessage: error?.message,
          ipAddress: ctx?.ipAddress,
          userAgent: ctx?.userAgent,
          status: 'failure',
        }),
      );
      throw error;
    }
  }
}
