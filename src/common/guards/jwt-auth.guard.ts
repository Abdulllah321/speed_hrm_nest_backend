import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import authConfig from '../../config/auth.config';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers['authorization'] as string;
    let token: string | undefined;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.cookies && req.cookies['accessToken']) {
      token = req.cookies['accessToken'];
    }

    if (!token) {
      // console.warn('HTTP 401 Warning: No token provided - ', req.method, req.url);
      throw new UnauthorizedException('No token provided');
    }

    try {
      const decoded = jwt.verify(token, authConfig.jwt.accessSecret, {
        issuer: authConfig.jwt.issuer,
      }) as any;

      // Fetch fresh permissions from DB
      // This solves the cookie size limit issue by keeping the JWT small
      const user = await this.prisma.user.findUnique({
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

      req.user = {
        ...decoded,
        roleName: user.role?.name,
        permissions: user.role?.permissions.map((p) => p.permission.name) || [],
      };
      
      return true;
    } catch (error) {
       // console.error('Token validation error:', error);
       throw new UnauthorizedException('Invalid token');
    }
  }
}
