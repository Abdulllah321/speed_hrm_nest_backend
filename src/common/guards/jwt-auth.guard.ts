import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import authConfig from '../../config/auth.config';
import { PrismaMasterService } from '../../database/prisma-master.service';

import { Reflector } from '@nestjs/core';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private prismaMaster: PrismaMasterService,
    private reflector: Reflector
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isOptional = this.reflector.getAllAndOverride<boolean>('isOptional', [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers['authorization'] as string;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies) {
      token = req.cookies['accessToken'];
    }

    if (!token) {
      if (isOptional) return true;
      // console.warn('HTTP 401 Warning: No token provided - ', req.method, req.url);
      throw new UnauthorizedException('No token provided');
    }

    try {
      const decoded = jwt.verify(token, authConfig.jwt.accessSecret, {
        issuer: authConfig.jwt.issuer,
      }) as any;

      // Validate Session if sessionId is present (for stateful auth)
      if (decoded.sessionId) {
        const session = await this.prismaMaster.userSession.findUnique({
          where: { id: decoded.sessionId }
        });

        if (!session) {
          throw new UnauthorizedException('Session expired or invalidated');
        }

        // Optional: Update last activity on session?
        // await this.prismaMaster.userSession.update({ where: { id: session.id }, data: { updatedAt: new Date() } });
      } else if (!decoded.isTerminal && !decoded.isPosUser) {
        // If no sessionId and it's a regular user token (not a legacy static token or terminal),
        // we might want to enforce session presence in the future.
        // For now, allow legacy tokens if needed, OR block them if we want strict enforcement.
        // Strict: throw new UnauthorizedException('Invalid token structure');
      }

      // Handle POS terminal authentication
      // Only treat as Terminal Identity if isTerminal is explicitly true AND it's not a User-on-Terminal session
      if (decoded.isTerminal && !decoded.isPosUser) {
        req.user = {
          ...decoded,
          id: decoded.terminalId, // Use terminalId as id for compatibility
          roleName: 'POS_TERMINAL',
          permissions: ['pos:*'],
        };
        return true;
      }

      // Fetch fresh permissions from DB
      // This solves the cookie size limit issue by keeping the JWT small
      const user = await this.prismaMaster.user.findUnique({
        where: { id: decoded.userId },
        select: {
          status: true,
          role: {
            select: {
              name: true,
              permissions: {
                select: {
                  permission: {
                    select: {
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      });

      if (!user || user.status !== 'active') {
        throw new UnauthorizedException('User not found or inactive');
      }

      const permissions =
        user.role?.permissions.map((p) => p.permission.name) || [];
      const roleName = user.role?.name?.toLowerCase();

      // Super Admin and Admin bypass
      if (roleName === 'super_admin' || roleName === 'admin') {
        if (!permissions.includes('*')) {
          permissions.push('*');
        }
      }

      req.user = {
        ...decoded,
        id: decoded.userId,
        roleName: user.role?.name,
        permissions: permissions,
      };

      return true;
    } catch (error) {
      if (isOptional) return true;
      // console.error('Token validation error:', error);
      throw new UnauthorizedException('Invalid token');
    }
  }
}
