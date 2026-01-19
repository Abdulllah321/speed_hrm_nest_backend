import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import authConfig from '../config/auth.config';

function parseExpiryToMs(expiry: string) {
  const m = expiry.match(/^(\d+)([smhd])$/);
  if (!m) return 30 * 24 * 60 * 60 * 1000;
  const v = parseInt(m[1]);
  const unit = m[2];
  const mult: Record<string, number> = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };
  return v * (mult[unit] || mult.d);
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) { }

  async login(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });
    if (!user) return { status: false, message: 'Invalid credentials' };
    if (user.status !== 'active')
      return { status: false, message: 'Account is not active' };
    const ok = await bcrypt.compare(password, user.password);
    // If password match fails, check if it's the first password (default might be needed logic, but here assume bcrypt matches)
    if (!ok) return { status: false, message: 'Invalid credentials' };

    // Create new session and refresh token (does NOT invalidate existing sessions - allows multiple devices)
    const accessOpts: jwt.SignOptions = {
      expiresIn: authConfig.jwt.accessExpiresIn as any,
      issuer: authConfig.jwt.issuer,
    };
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, roleId: user.roleId },
      authConfig.jwt.accessSecret,
      accessOpts,
    );
    const family = crypto.randomUUID(); // Each login gets a new family (new device)
    const refreshOpts: jwt.SignOptions = {
      expiresIn: authConfig.jwt.refreshExpiresIn as any,
      issuer: authConfig.jwt.issuer,
    };
    const refreshToken = jwt.sign(
      { userId: user.id, family },
      authConfig.jwt.refreshSecret,
      refreshOpts,
    );
    const refreshTokenExpiryMs = parseExpiryToMs(
      authConfig.jwt.refreshExpiresIn,
    );

    // Create refresh token for this device
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        family,
        expiresAt: new Date(Date.now() + refreshTokenExpiryMs),
      },
    });

    // Create new session for this device (doesn't affect other devices)
    await this.prisma.session.create({
      data: {
        userId: user.id,
        token: accessToken,
        isActive: true,
        ipAddress: ipAddress || null,
        userAgent: userAgent || null,
        lastActivityAt: new Date(),
        expiresAt: new Date(Date.now() + authConfig.security.sessionTimeout),
      },
    });

    return {
      status: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role?.name || null,
          permissions:
            user.role?.permissions.map((p) => p.permission.name) || [],
        },
        accessToken,
        refreshToken,
      },
    };
  }

  async refresh(token: string) {
    try {
      const decoded = jwt.verify(token, authConfig.jwt.refreshSecret) as any;
      const stored = await this.prisma.refreshToken.findUnique({
        where: { token },
      });
      if (!stored || stored.isRevoked || new Date() > stored.expiresAt)
        return { status: false, message: 'Invalid refresh token' };
      const user = await this.prisma.user.findUnique({
        where: { id: decoded.userId },
      });
      if (!user || user.status !== 'active')
        return { status: false, message: 'User not found or inactive' };
      const refreshTokenExpiryMs = parseExpiryToMs(
        authConfig.jwt.refreshExpiresIn,
      );
      const accessTokenExpiryMs = parseExpiryToMs(
        authConfig.jwt.accessExpiresIn,
      );

      // Revoke old refresh token (token rotation for security)
      await this.prisma.refreshToken.update({
        where: { id: stored.id },
        data: { isRevoked: true },
      });

      const family = decoded.family;
      const accessOpts: jwt.SignOptions = {
        expiresIn: authConfig.jwt.accessExpiresIn as any,
        issuer: authConfig.jwt.issuer,
      };
      const accessToken = jwt.sign(
        { userId: user.id, email: user.email, roleId: user.roleId },
        authConfig.jwt.accessSecret,
        accessOpts,
      );
      const refreshOpts: jwt.SignOptions = {
        expiresIn: authConfig.jwt.refreshExpiresIn as any,
        issuer: authConfig.jwt.issuer,
      };
      const newRefreshToken = jwt.sign(
        { userId: user.id, family },
        authConfig.jwt.refreshSecret,
        refreshOpts,
      );

      // Create new refresh token with same family (same device)
      await this.prisma.refreshToken.create({
        data: {
          userId: user.id,
          token: newRefreshToken,
          family,
          expiresAt: new Date(Date.now() + refreshTokenExpiryMs),
        },
      });

      // Update or create session with new access token
      const existingSession = await this.prisma.session.findFirst({
        where: { userId: user.id, isActive: true },
        orderBy: { lastActivityAt: 'desc' },
      });

      if (existingSession) {
        // Update existing session with new token and extend expiry
        await this.prisma.session.update({
          where: { id: existingSession.id },
          data: {
            token: accessToken,
            lastActivityAt: new Date(),
            expiresAt: new Date(
              Date.now() + authConfig.security.sessionTimeout,
            ),
          },
        });
      } else {
        // Create new session if none exists
        await this.prisma.session.create({
          data: {
            userId: user.id,
            token: accessToken,
            isActive: true,
            ipAddress: null,
            userAgent: null,
            lastActivityAt: new Date(),
            expiresAt: new Date(
              Date.now() + authConfig.security.sessionTimeout,
            ),
          },
        });
      }

      return {
        status: true,
        data: { accessToken, refreshToken: newRefreshToken },
      };
    } catch {
      return { status: false, message: 'Invalid refresh token' };
    }
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        avatar: true,
        employeeId: true,
        status: true,
        roleId: true,
        createdAt: true,
        updatedAt: true,

        isFirstPassword: true,
        role: {
          include: {
            permissions: { include: { permission: true } },
          },
        },
        employee: {
          select: {
            id: true,
            employeeId: true,
            designation: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
        preferences: {
          select: {
            id: true,
            key: true,
            value: true,
            createdAt: true,
            updatedAt: true,
          },
        },
      },
    });
    if (!user) return { status: false, message: 'User not found' };
    return { status: true, data: user };
  }

  async logout(userId: string, accessToken?: string) {
    // If accessToken is provided, only invalidate that specific session (single device logout)
    if (accessToken) {
      const session = await this.prisma.session.findFirst({
        where: { userId, token: accessToken, isActive: true },
      });
      if (session) {
        // Invalidate only this session
        await this.prisma.session.update({
          where: { id: session.id },
          data: { isActive: false },
        });
        // Note: We don't revoke refresh tokens here to allow token refresh to work
        // Refresh tokens will naturally expire, and users can manage sessions separately
      }
    } else {
      // No token provided - invalidate all sessions (backward compatibility or admin action)
      // This should rarely be used - prefer device-specific logout
      await this.prisma.session.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      });
      await this.prisma.refreshToken.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true },
      });
    }
    return { status: true, message: 'Logged out' };
  }

  async checkSession(userId: string, accessToken?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user)
      return {
        status: false,
        message: 'User not found',
        valid: false,
        resetCookies: true,
      };
    if (user.status !== 'active')
      return {
        status: false,
        message: 'User is not active',
        valid: false,
        resetCookies: true,
      };

    // Check session validity if token is provided
    if (accessToken) {
      const session = await this.prisma.session.findFirst({
        where: { userId, token: accessToken, isActive: true },
      });

      if (!session) {
        // No valid session found - session expired or invalid
        return {
          status: false,
          message: 'Session not found or expired',
          valid: false,
          resetCookies: true,
        };
      }

      // Check if session has expired
      const now = new Date();
      if (session.expiresAt < now) {
        // Session has expired - deactivate it and request cookie reset
        await this.prisma.session.update({
          where: { id: session.id },
          data: { isActive: false },
        });
        return {
          status: false,
          message: 'Session expired',
          valid: false,
          resetCookies: true,
        };
      }

      // Session is valid - update last activity and extend session expiry
      await this.prisma.session.update({
        where: { id: session.id },
        data: {
          lastActivityAt: new Date(),
          expiresAt: new Date(Date.now() + authConfig.security.sessionTimeout),
        },
      });
    } else {
      // No access token provided - check if user has any valid sessions
      const validSession = await this.prisma.session.findFirst({
        where: {
          userId,
          isActive: true,
          expiresAt: { gt: new Date() },
        },
      });

      if (!validSession) {
        // No valid session exists
        return {
          status: false,
          message: 'No valid session found',
          valid: false,
          resetCookies: true,
        };
      }
    }

    return {
      status: true,
      valid: true,
      data: { userId: user.id, email: user.email, roleId: user.roleId },
    };
  }

  async changePassword(
    userId: string,
    oldPassword: string,
    newPassword: string,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) return { status: false, message: 'User not found' };
    const ok = await bcrypt.compare(oldPassword, user.password);
    if (!ok) return { status: false, message: 'Invalid current password' };
    if ((newPassword || '').length < authConfig.password.minLength)
      return {
        status: false,
        message: `Password must be at least ${authConfig.password.minLength} characters`,
      };
    const hashed = await bcrypt.hash(
      newPassword,
      authConfig.password.saltRounds,
    );
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashed, isFirstPassword: false },
    });
    return { status: true, message: 'Password changed' };
  }

  async updateMe(userId: string, data: any) {
    const allowedFields = ['firstName', 'lastName', 'phone', 'avatar'];
    const updateData: any = {};

    // Filter out restricted fields
    for (const key of Object.keys(data)) {
      if (allowedFields.includes(key)) {
        updateData[key] = data[key];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return { status: false, message: 'No valid fields to update' };
    }

    const user = await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        employee: {
          select: {
            id: true,
            employeeId: true,
            designation: { select: { name: true } },
            department: { select: { name: true } },
          },
        },
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });

    return { status: true, data: user, message: 'Profile updated' };
  }

  async getActiveSessions(userId: string) {
    const sessions = await this.prisma.session.findMany({
      where: { userId, isActive: true },
      orderBy: { lastActivityAt: 'desc' },
    });
    return { status: true, data: sessions };
  }

  async terminateSession(userId: string, sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.userId !== userId)
      return { status: false, message: 'Session not found' };
    await this.prisma.session.update({
      where: { id: sessionId },
      data: { isActive: false },
    });
    return { status: true, message: 'Session terminated' };
  }

  async getLoginHistory(userId: string) {
    const logs = await this.prisma.loginHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { status: true, data: logs };
  }

  async getAllUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        role: true,
      }
    });
    return { status: true, data: users };
  }

  async createUser(data: any) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      // If user exists, we allow updating the password if it's being created by an admin (implied by the flow)
      // This handles the case where Employee creation auto-created a user with a random password
      if (data.password) {
        const hashedPassword = await bcrypt.hash(
          data.password,
          authConfig.password.saltRounds,
        );

        const updatedUser = await this.prisma.user.update({
          where: { email: data.email },
          data: {
            password: hashedPassword,
            // Update other fields if provided and needed, e.g. linking employee if not linked
            ...(data.employeeId ? { employeeId: data.employeeId } : {}),
            ...(data.roleId ? { roleId: data.roleId } : {}),
            ...(data.firstName ? { firstName: data.firstName } : {}),
            ...(data.lastName ? { lastName: data.lastName } : {}),
          },
        });
        
        return { status: true, data: updatedUser, message: 'User account updated successfully' };
      }

      return { status: false, message: 'User with this email already exists' };
    }

    const hashedPassword = await bcrypt.hash(
      data.password,
      authConfig.password.saltRounds,
    );

    const user = await this.prisma.user.create({
      data: {
        ...data,
        password: hashedPassword,
        isFirstPassword: true, // Default to true for new users
      },
    });

    return { status: true, data: user, message: 'User created successfully' };
  }

  async updateUser(id: string, data: any) {
    const user = await this.prisma.user.update({ where: { id }, data });
    return { status: true, data: user };
  }

  async getRoles() {
    const roles = await this.prisma.role.findMany({
      orderBy: { name: 'asc' },
      include: { permissions: { include: { permission: true } } },
    });
    return { status: true, data: roles };
  }

  async getPermissions() {
    const permissions = await this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
    return { status: true, data: permissions };
  }

  async getAllActivityLogs() {
    const logs = await this.prisma.activityLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { status: true, data: logs };
  }

  /**
   * Check if a user has a specific permission
   * @param userId - User ID
   * @param permissionName - Permission name (e.g., 'employees.create')
   * @returns true if user has the permission, false otherwise
   */
  async hasPermission(
    userId: string,
    permissionName: string,
  ): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    if (!user || !user.role) {
      return false;
    }

    return user.role.permissions.some(
      (rolePermission) => rolePermission.permission.name === permissionName,
    );
  }

  /**
   * Get all permissions for a user
   * @param userId - User ID
   * @returns Array of permission names
   */
  async getUserPermissions(userId: string): Promise<string[]> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        role: {
          include: {
            permissions: {
              include: {
                permission: true,
              },
            },
          },
        },
      },
    });

    if (!user || !user.role) {
      return [];
    }

    return user.role.permissions.map((rp) => rp.permission.name);
  }

  /**
   * Check if a user has any of the specified permissions
   * @param userId - User ID
   * @param permissionNames - Array of permission names
   * @returns true if user has at least one of the permissions
   */
  async hasAnyPermission(
    userId: string,
    permissionNames: string[],
  ): Promise<boolean> {
    const userPermissions = await this.getUserPermissions(userId);
    return permissionNames.some((permission) =>
      userPermissions.includes(permission),
    );
  }

  /**
   * Check if a user has all of the specified permissions
   * @param userId - User ID
   * @param permissionNames - Array of permission names
   * @returns true if user has all of the permissions
   */
  async hasAllPermissions(
    userId: string,
    permissionNames: string[],
  ): Promise<boolean> {
    const userPermissions = await this.getUserPermissions(userId);
    return permissionNames.every((permission) =>
      userPermissions.includes(permission),
    );
  }
}
