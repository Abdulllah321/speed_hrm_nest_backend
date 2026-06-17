import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
  mixin,
  Type,
} from '@nestjs/common';

/**
 * PermissionGuard Factory
 * Use it like: @UseGuards(JwtAuthGuard, PermissionGuard('permission.name'))
 * Or: @UseGuards(JwtAuthGuard, PermissionGuard(['perm1', 'perm2']))
 */
export const PermissionGuard = (
  requiredPermissions: string | string[],
): Type<CanActivate> => {
  @Injectable()
  class PermissionGuardMixin implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const { user } = context.switchToHttp().getRequest();

      if (!user || !user.permissions) {
        throw new ForbiddenException('User permissions not found in token');
      }

      const permissionsArray = Array.isArray(requiredPermissions)
        ? requiredPermissions
        : [requiredPermissions];

      // If user is admin/super-admin, or has '*' permission, bypass checks
      const role = (
        typeof user.roleName === 'string' ? user.roleName :
        typeof user.role === 'string' ? user.role :
        user.role?.name || ''
      ).toLowerCase();

      if (
        role === 'admin' ||
        role === 'super-admin' ||
        role === 'super_admin' ||
        user.permissions.includes('*')
      ) {
        return true;
      }

      const hasPermission = permissionsArray.some((permission) =>
        user.permissions.includes(permission),
      );

      if (!hasPermission) {
        throw new ForbiddenException(
          `Missing required permission(s): ${permissionsArray.join(', ')}`,
        );
      }

      return true;
    }
  }

  return mixin(PermissionGuardMixin);
};
