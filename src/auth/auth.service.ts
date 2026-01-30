import { Injectable, Optional } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import authConfig from '../config/auth.config';
import { PrismaMasterService } from '../database/prisma-master.service';
import { PrismaService } from '../database/prisma.service';

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
  constructor(
    private prismaMaster: PrismaMasterService,
    @Optional() private prismaTenant: PrismaService,
  ) { }

  async login(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    const user = await this.prismaMaster.user.findUnique({
      where: { email },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });
    if (!user) return { status: false, message: 'Invalid credentials' };
    if (user.status !== 'active')
      return { status: false, message: 'Account is not active' };
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return { status: false, message: 'Invalid credentials' };

    const accessOpts: jwt.SignOptions = {
      expiresIn: authConfig.jwt.accessExpiresIn as any,
      issuer: authConfig.jwt.issuer,
    };
    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, roleId: user.roleId },
      authConfig.jwt.accessSecret,
      accessOpts,
    );
    const family = crypto.randomUUID();
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

    await this.prismaMaster.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        family,
        expiresAt: new Date(Date.now() + refreshTokenExpiryMs),
      },
    });

    await this.prismaMaster.session.create({
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

    await this.prismaMaster.loginHistory.create({
      data: {
        userId: user.id,
        ipAddress: ipAddress || 'Unknown',
        userAgent: userAgent || null,
        status: 'success',
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
            user.role?.permissions
              .filter((p) => p.permission) // Filter out null permissions
              .map((p) => p.permission.name) || [],
        },
        accessToken,
        refreshToken,
      },
    };
  }

  async refresh(token: string) {
    try {
      const decoded = jwt.verify(token, authConfig.jwt.refreshSecret) as any;
      const stored = await this.prismaMaster.refreshToken.findUnique({
        where: { token },
      });
      if (!stored) {
        return { status: false, message: 'Invalid refresh token (not found)' };
      }
      if (stored.isRevoked) {
        return { status: false, message: 'Invalid refresh token (revoked)' };
      }
      if (new Date() > stored.expiresAt) {
        return { status: false, message: 'Invalid refresh token (expired)' };
      }

      const user = await this.prismaMaster.user.findUnique({
        where: { id: decoded.userId },
      });
      if (!user || user.status !== 'active')
        return { status: false, message: 'User not found or inactive' };
      const refreshTokenExpiryMs = parseExpiryToMs(
        authConfig.jwt.refreshExpiresIn,
      );

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

      await this.prismaMaster.$transaction(async (tx) => {
        await tx.refreshToken.update({
          where: { id: stored.id },
          data: { isRevoked: true },
        });

        await tx.refreshToken.create({
          data: {
            userId: user.id,
            token: newRefreshToken,
            family,
            expiresAt: new Date(Date.now() + refreshTokenExpiryMs),
          },
        });

        const existingSession = await tx.session.findFirst({
          where: { userId: user.id, isActive: true },
          orderBy: { lastActivityAt: 'desc' },
        });

        if (existingSession) {
          await tx.session.update({
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
          await tx.session.create({
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
      });

      return {
        status: true,
        data: { accessToken, refreshToken: newRefreshToken },
      };
    } catch (error) {
      return { status: false, message: 'Invalid refresh token' };
    }
  }

  async me(userId: string) {
    const user = (await this.prismaMaster.user.findUnique({
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
    })) as any;

    if (!user) return { status: false, message: 'User not found' };

    // Resolve employee details if prismaTenant is available
    if (this.prismaTenant) {
      try {

        const employee = await this.prismaTenant.employee.findUnique({
          where: { userId },
          select: {
            id: true,
            employeeId: true,
            departmentId: true,
            designationId: true,
            employeeName: true,
          },
        });

        if (employee) {
          // Fetch Master data for department and designation
          const [dept, desg] = await Promise.all([
            this.prismaMaster.department.findUnique({
              where: { id: employee.departmentId || '' },
            }),
            this.prismaMaster.designation.findUnique({
              where: { id: employee.designationId || '' },
            }),
          ]);

          user.employee = {
            ...employee,
            department: dept,
            designation: desg,
          };
        }
      } catch (err) {
        // Silently fail if tenant context not available or connection fails
      }
    }

    return { status: true, data: user };
  }

  async logout(userId: string, accessToken?: string) {
    if (accessToken) {
      const session = await this.prismaMaster.session.findFirst({
        where: { userId, token: accessToken, isActive: true },
      });
      if (session) {
        await this.prismaMaster.session.update({
          where: { id: session.id },
          data: { isActive: false },
        });
      }
    } else {
      await this.prismaMaster.session.updateMany({
        where: { userId, isActive: true },
        data: { isActive: false },
      });
      await this.prismaMaster.refreshToken.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true },
      });
    }
    return { status: true, message: 'Logged out' };
  }

  async checkSession(userId: string, accessToken?: string) {
    const user = await this.prismaMaster.user.findUnique({
      where: { id: userId },
    });
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

    if (accessToken) {
      const session = await this.prismaMaster.session.findFirst({
        where: { userId, token: accessToken, isActive: true },
      });

      if (!session) {
        return {
          status: false,
          message: 'Session not found or expired',
          valid: false,
          resetCookies: true,
        };
      }

      const now = new Date();
      if (session.expiresAt < now) {
        await this.prismaMaster.session.update({
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

      await this.prismaMaster.session.update({
        where: { id: session.id },
        data: {
          lastActivityAt: new Date(),
          expiresAt: new Date(Date.now() + authConfig.security.sessionTimeout),
        },
      });
    } else {
      const validSession = await this.prismaMaster.session.findFirst({
        where: {
          userId,
          isActive: true,
          expiresAt: { gt: new Date() },
        },
      });

      if (!validSession) {
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
    const user = await this.prismaMaster.user.findUnique({
      where: { id: userId },
    });
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
    await this.prismaMaster.user.update({
      where: { id: userId },
      data: { password: hashed, isFirstPassword: false },
    });
    return { status: true, message: 'Password changed' };
  }

  async updateMe(userId: string, data: any) {
    const allowedFields = ['firstName', 'lastName', 'phone', 'avatar'];
    const updateData: any = {};

    for (const key of Object.keys(data)) {
      if (allowedFields.includes(key)) {
        updateData[key] = data[key];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return { status: false, message: 'No valid fields to update' };
    }

    const user = (await this.prismaMaster.user.update({
      where: { id: userId },
      data: updateData,
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
      },
    })) as any;

    // Resolve employee details if prismaTenant is available
    if (this.prismaTenant) {
      try {

        const employee = await this.prismaTenant.employee.findUnique({
          where: { userId },
          select: {
            id: true,
            employeeId: true,
            departmentId: true,
            designationId: true,
            employeeName: true,
          },
        });

        if (employee) {
          const [dept, desg] = await Promise.all([
            this.prismaMaster.department.findUnique({
              where: { id: employee.departmentId || '' },
            }),
            this.prismaMaster.designation.findUnique({
              where: { id: employee.designationId || '' },
            }),
          ]);

          user.employee = {
            ...employee,
            department: dept,
            designation: desg,
          };
        }
      } catch (err) {
        // Silently fail
      }
    }

    return { status: true, data: user, message: 'Profile updated' };
  }

  async getActiveSessions(userId: string, currentAccessToken?: string) {
    const sessions = await this.prismaMaster.session.findMany({
      where: { userId, isActive: true },
      orderBy: { lastActivityAt: 'desc' },
    });

    const data = sessions.map((session) => ({
      id: session.id,
      userId: session.userId,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      deviceInfo: session.deviceInfo,
      lastActivityAt: session.lastActivityAt,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
      isCurrent: currentAccessToken
        ? session.token === currentAccessToken
        : false,
    }));

    return { status: true, data };
  }

  async terminateSession(userId: string, sessionId: string) {
    const session = await this.prismaMaster.session.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.userId !== userId)
      return { status: false, message: 'Session not found' };
    await this.prismaMaster.session.update({
      where: { id: sessionId },
      data: { isActive: false },
    });
    return { status: true, message: 'Session terminated' };
  }

  async getLoginHistory(userId: string) {
    const logs = await this.prismaMaster.loginHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return { status: true, data: logs };
  }

  async getAllUsers() {
    const users = (await this.prismaMaster.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        role: true,
      },
    })) as any[];

    // If tenant is connected, map employees to users
    if (this.prismaTenant) {
      try {

        const userIds = users.map((u) => u.id);
        const employees = await this.prismaTenant.employee.findMany({
          where: { userId: { in: userIds } },
          select: {
            userId: true,
            id: true,
            employeeName: true,
            departmentId: true,
            designationId: true,
          },
        });

        const employeeMap = new Map(employees.map((e) => [e.userId, e]));

        // Fetch Master data for departments and designations
        const deptIds = [
          ...new Set(
            employees.map((e) => e.departmentId).filter(Boolean) as string[],
          ),
        ];
        const desgIds = [
          ...new Set(
            employees.map((e) => e.designationId).filter(Boolean) as string[],
          ),
        ];

        const [departments, designations] = await Promise.all([
          this.prismaMaster.department.findMany({
            where: { id: { in: deptIds } },
          }),
          this.prismaMaster.designation.findMany({
            where: { id: { in: desgIds } },
          }),
        ]);

        const deptMap = new Map(departments.map((d) => [d.id, d.name]));
        const desgMap = new Map(designations.map((d) => [d.id, d.name]));

        for (const user of users) {
          const emp = employeeMap.get(user.id) as any;
          if (emp) {
            (user as any).employee = {
              ...emp,
              department: emp.departmentId
                ? { name: deptMap.get(emp.departmentId) }
                : null,
              designation: emp.designationId
                ? { name: desgMap.get(emp.designationId) }
                : null,
            };
          }
        }
      } catch (err) {
        // Silently fail if tenant context not available
      }
    }

    return { status: true, data: users };
  }

  async createUser(data: any) {
    const existingUser = await this.prismaMaster.user.findUnique({
      where: { email: data.email },
    });

    if (existingUser) {
      if (data.password) {
        const hashedPassword = await bcrypt.hash(
          data.password,
          authConfig.password.saltRounds,
        );

        const updatedUser = await this.prismaMaster.user.update({
          where: { email: data.email },
          data: {
            password: hashedPassword,
            ...(data.employeeId ? { employeeId: data.employeeId } : {}),
            ...(data.roleId ? { roleId: data.roleId } : {}),
            ...(data.firstName ? { firstName: data.firstName } : {}),
            ...(data.lastName ? { lastName: data.lastName } : {}),
          },
        });

        return {
          status: true,
          data: updatedUser,
          message: 'User account updated successfully',
        };
      }

      return { status: false, message: 'User with this email already exists' };
    }

    const hashedPassword = await bcrypt.hash(
      data.password,
      authConfig.password.saltRounds,
    );

    const user = await this.prismaMaster.user.create({
      data: {
        ...data,
        password: hashedPassword,
        isFirstPassword: true,
      },
    });

    return { status: true, data: user, message: 'User created successfully' };
  }

  async updateUser(id: string, data: any) {
    const user = await this.prismaMaster.user.update({ where: { id }, data });
    return { status: true, data: user };
  }

  async getRoles() {
    const roles = await this.prismaMaster.role.findMany({
      orderBy: { name: 'asc' },
      include: { permissions: { include: { permission: true } } },
    });
    return { status: true, data: roles };
  }

  async getPermissions() {
    const permissions = await this.prismaMaster.permission.findMany({
      orderBy: [{ module: 'asc' }, { action: 'asc' }],
    });
    return { status: true, data: permissions };
  }

  async getAllActivityLogs() {
    const logs = await this.prismaMaster.activityLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { status: true, data: logs };
  }

  async hasPermission(
    userId: string,
    permissionName: string,
  ): Promise<boolean> {
    const user = await this.prismaMaster.user.findUnique({
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

  async getUserPermissions(userId: string): Promise<string[]> {
    const user = await this.prismaMaster.user.findUnique({
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

  async hasAnyPermission(
    userId: string,
    permissionNames: string[],
  ): Promise<boolean> {
    const userPermissions = await this.getUserPermissions(userId);
    return permissionNames.some((permission) =>
      userPermissions.includes(permission),
    );
  }

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
