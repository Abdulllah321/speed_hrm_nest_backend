import {
  Injectable,
  Logger,
  Optional,
  Inject,
  forwardRef,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import authConfig from '../config/auth.config';
import { PrismaMasterService } from '../database/prisma-master.service';
import { PrismaService } from '../database/prisma.service';
import { CompanyService } from '../admin/company/company.service';
import { PosService } from '../master/pos/pos.service';
import { EncryptionService } from '../common/utils/encryption.service';
import { PosSessionService } from '../pos-session/pos-session.service';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

function parseExpiryToMs(expiry: string) {
  const m = expiry.match(/^(""d+)([smhd])$/);
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
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prismaMaster: PrismaMasterService,
    @Inject(forwardRef(() => CompanyService))
    private companyService: CompanyService,
    private posService: PosService,
    @Optional() private prisma: PrismaService,
    private encryptionService: EncryptionService,
    private posSessionService: PosSessionService,
  ) { }

  async login(
    email: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
    browserId?: string
  ) {
    const user = await this.prismaMaster.user.findUnique({
      where: { email },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });
    if (!user) return { status: false, message: 'user not found' };
    if (user.status !== 'active')
      return { status: false, message: 'Account is not active' };
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return { status: false, message: "Password doesn't match" };

    // Update Login History
    await this.prismaMaster.loginHistory.create({
      data: {
        userId: user.id,
        ipAddress: ipAddress || 'Unknown',
        userAgent: userAgent || null,
        status: 'success',
      },
    });

    // Handle Session Management
    const sessionToken = uuidv4();
    const sessionId = await this.manageActiveSessions(user.id, user.role?.name || 'User', sessionToken, {
      ip: ipAddress,
      userAgent,
      browserId
    });

    const accessOpts: jwt.SignOptions = {
      expiresIn: authConfig.jwt.accessExpiresIn as any,
      issuer: authConfig.jwt.issuer,
    };

    // Include sessionId in payload
    const payload = {
      userId: user.id,
      email: user.email,
      roleId: user.roleId,
      employeeId: user.employeeId,
      roleName: user.role?.name || null,
      sessionId: sessionId,
    };

    const accessToken = jwt.sign(payload, authConfig.jwt.accessSecret, accessOpts);

    const refreshOpts: jwt.SignOptions = {
      expiresIn: authConfig.jwt.refreshExpiresIn as any,
      issuer: authConfig.jwt.issuer,
    };
    const refreshToken = jwt.sign(
      { userId: user.id, sessionId: sessionId },
      authConfig.jwt.refreshSecret,
      refreshOpts,
    );

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
              .filter((p) => p.permission)
              .map((p) => p.permission.name) || [],
        },
        accessToken,
        refreshToken,
        sessionId
      },
    };
  }

  /**
   * Impersonate another user by employeeId (admin-only).
   * Creates a new access/refresh token pair and session for the target user.
   */
  async impersonateByEmployee(
    actingUserId: string,
    employeeId: string,
    ipAddress?: string,
    userAgent?: string,
  ) {
    // 1. Verify acting user is allowed (admin / super admin)
    const actingUser = await this.prismaMaster.user.findUnique({
      where: { id: actingUserId },
      include: { role: true },
    });

    if (
      !actingUser ||
      !actingUser.role ||
      !['admin', 'super_admin', 'super admin'].includes(
        (actingUser.role.name || '').toLowerCase().trim(),
      )
    ) {
      return { status: false, message: 'Not authorized to impersonate users' };
    }

    // 2. Fetch employee details from Tenant DB first (we need this for JIT provisioning)
    const employeeDetails = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true,
        employeeId: true,
        employeeName: true,
        officialEmail: true,
        personalEmail: true,
        designationId: true,
        departmentId: true,
        status: true,
      },
    });

    if (!employeeDetails) {
      return { status: false, message: 'Employee record not found in system' };
    }

    // 3. Find target user in Master DB by employeeId
    let targetUser = await this.prismaMaster.user.findFirst({
      where: { employeeId },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });

    // 4. JIT: If no user account is found, create/assign the dashboard account
    if (!targetUser) {
      const email = employeeDetails.officialEmail || employeeDetails.personalEmail;
      if (!email) {
        return { status: false, message: 'Employee has no email configured. Cannot create dashboard account.' };
      }

      // Check if user exists by email but isn't linked to this employeeId
      targetUser = await this.prismaMaster.user.findUnique({
        where: { email },
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      });

      if (targetUser) {
        // Link existing user to this employeeId and enable dashboard
        targetUser = await this.prismaMaster.user.update({
          where: { id: targetUser.id },
          data: {
            employeeId,
            isDashboardEnabled: true,
            status: 'active'
          },
          include: {
            role: { include: { permissions: { include: { permission: true } } } },
          },
        });
      } else {
        // Create brand new user account
        const nameParts = (employeeDetails.employeeName || '').split(' ');
        const firstName = nameParts[0] || 'Employee';
        const lastName = nameParts.slice(1).join(' ') || '.';

        targetUser = await this.prismaMaster.user.create({
          data: {
            email,
            firstName,
            lastName,
            employeeId,
            status: 'active',
            isDashboardEnabled: true,
            isFirstPassword: true,
            mustChangePassword: true,
            authProvider: 'local',
          },
          include: {
            role: { include: { permissions: { include: { permission: true } } } },
          },
        });
      }
    }

    // 5. Final validation of target
    if (targetUser.status !== 'active' || employeeDetails.status !== 'active') {
      return { status: false, message: 'Account or employee is not active' };
    }

    // Force enable dashboard if it was previously disabled
    if (targetUser.isDashboardEnabled === false) {
      targetUser = await this.prismaMaster.user.update({
        where: { id: targetUser.id },
        data: { isDashboardEnabled: true },
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      });
    }

    // Fetch master data for designation and department display
    let designationName: string | null = null;
    let departmentName: string | null = null;

    if (employeeDetails.designationId) {
      const designation = await this.prisma.designation.findUnique({
        where: { id: employeeDetails.designationId },
      });
      designationName = designation?.name || null;
    }
    if (employeeDetails.departmentId) {
      const department = await this.prisma.department.findUnique({
        where: { id: employeeDetails.departmentId },
      });
      departmentName = department?.name || null;
    }

    // 6. Generate Impersonation Session
    const accessOpts: jwt.SignOptions = {
      expiresIn: authConfig.jwt.accessExpiresIn as any,
      issuer: authConfig.jwt.issuer,
    };
    const accessToken = jwt.sign(
      {
        userId: targetUser.id,
        email: targetUser.email,
        roleId: targetUser.roleId,
        employeeId: targetUser.employeeId,
        roleName: targetUser.role?.name || null,
        impersonatorId: actingUserId,
        isImpersonating: true,
      },
      authConfig.jwt.accessSecret,
      accessOpts,
    );

    const refreshOpts: jwt.SignOptions = {
      expiresIn: authConfig.jwt.refreshExpiresIn as any,
      issuer: authConfig.jwt.issuer,
    };
    const refreshToken = jwt.sign(
      {
        userId: targetUser.id,
        impersonatorId: actingUserId,
        isImpersonating: true,
      },
      authConfig.jwt.refreshSecret,
      refreshOpts,
    );

    return {
      status: true,
      data: {
        user: {
          id: targetUser.id,
          email: targetUser.email,
          firstName: targetUser.firstName,
          lastName: targetUser.lastName,
          role: targetUser.role?.name || null,
          permissions:
            targetUser.role?.permissions.map((p) => p.permission.name) || [],
          employee: {
            id: employeeDetails.id,
            employeeId: employeeDetails.employeeId,
            designation: designationName,
            department: departmentName,
          },
        },
        accessToken,
        refreshToken,
      },
    };
  }

  /**
   * Stop impersonating and return to the original admin session.
   */
  async stopImpersonating(impersonatorId: string) {
    const user = await this.prismaMaster.user.findUnique({
      where: { id: impersonatorId },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });

    if (!user) return { status: false, message: 'Original user not found' };
    if (user.status !== 'active') return { status: false, message: 'Original account is not active' };

    const accessOpts: jwt.SignOptions = {
      expiresIn: authConfig.jwt.accessExpiresIn as any,
      issuer: authConfig.jwt.issuer,
    };

    const payload = {
      userId: user.id,
      email: user.email,
      roleId: user.roleId,
      employeeId: user.employeeId,
      roleName: user.role?.name || null,
    };

    const accessToken = jwt.sign(payload, authConfig.jwt.accessSecret, accessOpts);

    const refreshOpts: jwt.SignOptions = {
      expiresIn: authConfig.jwt.refreshExpiresIn as any,
      issuer: authConfig.jwt.issuer,
    };
    const refreshToken = jwt.sign(
      { userId: user.id },
      authConfig.jwt.refreshSecret,
      refreshOpts,
    );

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
              .filter((p) => p.permission)
              .map((p) => p.permission.name) || [],
        },
        accessToken,
        refreshToken,
      },
    };
  }

  /**
   * SSO Login via DriveSafe JWT token.
   * Implements Just-in-Time (JIT) provisioning for tenants and users.
   */
  async ssoLogin(token: string, ipAddress?: string, userAgent?: string) {
    // Get the DriveSafe SSO secret from environment
    const ssoSecret = process.env.DRIVESAFE_SSO_SECRET;
    if (!ssoSecret) {
      console.error('DRIVESAFE_SSO_SECRET not configured');
      return { status: false, message: 'SSO not configured' };
    }

    // Verify the JWT token
    let payload: any;
    try {
      payload = jwt.verify(token, ssoSecret);
    } catch (err: any) {
      console.warn(`Invalid SSO token: ${err.message}`);
      return { status: false, message: 'Invalid or expired SSO token' };
    }

    // Extract required fields from payload
    const {
      dealer_id,
      dealer_name,
      user_id,
      name,
      email,
      role: roleName,
      aud,
    } = payload;

    // Validate audience if configured
    const expectedAudience = process.env.DRIVESAFE_SSO_AUDIENCE || 'hrm';
    if (aud && aud !== expectedAudience) {
      console.warn(`Invalid SSO audience: ${aud}`);
      return { status: false, message: 'Invalid token audience' };
    }

    // Validate required fields
    if (!dealer_id || !user_id || !email) {
      console.warn('Missing required fields in SSO payload');
      return { status: false, message: 'Invalid SSO payload' };
    }

    // --- JIT Provisioning: Tenant ---
    let tenant = await this.prismaMaster.tenant.findUnique({
      where: { externalId: dealer_id },
    });

    if (!tenant) {
      // Create new tenant & company (JIT) via CompanyService
      const code = (dealer_name || dealer_id)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .substring(0, 32);

      console.log(`JIT: Provisioning new company for dealer_id: ${dealer_id}`);

      const createResult = await this.companyService.createCompany({
        name: dealer_name || `Dealer ${dealer_id}`,
        code: `${code}-${Date.now().toString(36)}`, // Ensure uniqueness
        externalId: dealer_id,
      });

      if (!createResult.status) {
        console.error(`JIT Provisioning failed: ${createResult.message}`);
        return { status: false, message: 'Failed to provision account' };
      }

      // Re-fetch created tenant
      tenant = await this.prismaMaster.tenant.findUnique({
        where: { externalId: dealer_id },
      });
    }

    if (!tenant || !tenant.isActive) {
      console.warn(`Tenant is inactive or missing: ${dealer_id}`);
      return { status: false, message: 'Dealer account is inactive' };
    }

    // --- JIT Provisioning: User ---
    let user = await this.prismaMaster.user.findUnique({
      where: { externalId: user_id },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
      },
    });

    // Parse name into first/last
    const nameParts = (name || email.split('@')[0]).split(' ');
    const firstName = nameParts[0] || 'User';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Resolve role if provided
    let roleRecord: any = null;
    console.log(`Role name: ${roleName}`);
    if (roleName) {
      roleRecord = await this.prismaMaster.role.findFirst({
        where: { name: { equals: roleName, mode: 'insensitive' } },
      });
    }

    if (!user) {
      // Create new user (JIT)
      console.log(`JIT: Creating new user for user_id: ${user_id}`);
      user = await this.prismaMaster.user.create({
        data: {
          externalId: user_id,
          email,
          firstName,
          lastName,
          password: null, // SSO users have no password
          authProvider: 'drivesafe_sso',
          tenantId: tenant.id,
          status: 'active',
          roleId: roleRecord?.id,
          isDashboardEnabled: true,
          isFirstPassword: false,
          mustChangePassword: false,
        },
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      });
    } else {
      // Update user info on each login (sync)
      user = await this.prismaMaster.user.update({
        where: { externalId: user_id },
        data: {
          email,
          firstName,
          lastName,
          tenantId: tenant.id,
          roleId: roleRecord?.id || user.roleId,
          lastLoginAt: new Date(),
          lastLoginIp: ipAddress,
        },
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      });
    }

    if (user.status !== 'active') {
      console.warn(`User is inactive: ${user_id}`);
      return { status: false, message: 'User account is inactive' };
    }

    // --- Create HRM Session ---
    const accessOpts: jwt.SignOptions = {
      expiresIn: authConfig.jwt.accessExpiresIn as any,
      issuer: authConfig.jwt.issuer,
    };
    const accessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        roleId: user.roleId,
        employeeId: user.employeeId,
        tenantId: tenant.id,
        roleName: user.role?.name || null,
        authProvider: 'drivesafe_sso',
      },
      authConfig.jwt.accessSecret,
      accessOpts,
    );

    const refreshOpts: jwt.SignOptions = {
      expiresIn: authConfig.jwt.refreshExpiresIn as any,
      issuer: authConfig.jwt.issuer,
    };
    const refreshToken = jwt.sign(
      { userId: user.id },
      authConfig.jwt.refreshSecret,
      refreshOpts,
    );

    await this.prismaMaster.loginHistory.create({
      data: {
        userId: user.id,
        ipAddress: ipAddress || 'Unknown',
        userAgent: userAgent || null,
        status: 'success',
        deviceInfo: 'SSO:DriveSafe',
      },
    });

    await this.prismaMaster.loginHistory.create({
      data: {
        userId: user.id,
        ipAddress: ipAddress || 'Unknown',
        userAgent: userAgent || null,
        status: 'success',
        deviceInfo: 'SSO:DriveSafe',
      },
    });

    console.log(`SSO login successful for user: ${user.email}`);

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
              .filter((p) => p.permission)
              .map((p) => p.permission.name) || [],
        },
        tenant: {
          id: tenant.id,
          code: tenant.code,
          name: tenant.name,
        },
        accessToken,
        refreshToken,
      },
    };
  }

  private toRad(Value: number) {
    return (Value * Math.PI) / 180;
  }

  private calculateDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ) {
    const R = 6371e3; // metres
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
      Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  async getGlobalPosLoginContext(ip: string, code: string) {
    if (!code) {
      return { status: false, message: 'Location Code is required' };
    }

    const companies = await this.prismaMaster.company.findMany({
      where: { status: 'active' }
    });

    if (!companies.length) {
      return { status: false, message: 'No active companies found' };
    }

    for (const company of companies) {
      let dbUrl = company.dbUrl;
      if (!dbUrl) continue;

      if (company.dbPassword) {
        try {
          const plainPassword = this.encryptionService.decrypt(company.dbPassword);
          const encodedPassword = encodeURIComponent(String(plainPassword));
          if (company.dbUser && company.dbHost && company.dbName) {
            const encodedUser = encodeURIComponent(company.dbUser);
            const encodedHost = company.dbHost;
            const encodedDbName = encodeURIComponent(company.dbName);
            const port = company.dbPort || 5432;
            dbUrl = `postgresql://${encodedUser}:${encodedPassword}@${encodedHost}:${port}/${encodedDbName}?schema=public`;

            this.logger.debug(`Reconstructed DB URL for global context company ${company.code} (password masked)`);
          }
        } catch (err) {
          this.logger.error(`Failed to decrypt database password for company ${company.id}`);
          continue;
        }
      }

      try {
        const { Pool } = require('pg');
        const { PrismaPg } = require('@prisma/adapter-pg');
        const { PrismaClient } = require('@prisma/client');
        const tempPool = new Pool({ connectionString: dbUrl, max: 2, connectionTimeoutMillis: 2000 });
        const adapter = new PrismaPg(tempPool);
        const tempPrisma = new PrismaClient({ adapter });

        try {
          const location = await tempPrisma.location.findFirst({
            where: { code: { equals: code, mode: 'insensitive' }, status: 'active' },
            include: { pos: { where: { status: 'active' } } },
          });

          if (location) {
            if (location.ipWhitelistEnabled && location.ipWhitelist) {
              const allowedIps = location.ipWhitelist.split(',').map((i: string) => i.trim());
              if (!allowedIps.includes(ip)) {
                return { status: false, message: 'Access denied from this IP address on the identified location' };
              }
            }

            const payload = {
              status: true,
              data: {
                tenantContext: {
                  tenantId: company.tenantId,
                  companyCode: company.code
                },
                location: {
                  id: location.id,
                  name: location.name,
                  code: location.code,
                },
                terminals: location.pos.map((p: any) => ({
                  id: p.id,
                  name: p.name,
                  code: p.terminalCode,
                  status: p.status,
                })),
              },
            };

            return payload;
          }
        } finally {
          await tempPrisma.$disconnect();
          await tempPool.end();
        }
      } catch (err) {
        this.logger.error(`Error querying tenant DB for company ${company.code}:`, err);
        continue;
      }
    }

    return { status: false, message: 'Location Code not found anywhere in the system' };
  }

  async getPosLoginContext(
    ip: string,
    code?: string,
    lat?: number,
    lng?: number,
  ) {
    this.prisma.ensureTenantContext();
    let location: any = null;

    if (code) {
      location = await this.prisma.location.findFirst({
        where: { code: { equals: code, mode: 'insensitive' }, status: 'active' },
        include: { pos: { where: { status: 'active' } } },
      });
      if (!location) return { status: false, message: 'Invalid Location Code' };

      // Validate GeoFence if enabled
      if (location.geoFenceEnabled) {
        if (!lat || !lng) {
          return {
            status: false,
            message: 'Location access required for this site',
          };
        }
        const dist = this.calculateDistance(
          lat,
          lng,
          Number(location.latitude),
          Number(location.longitude),
        );
        if (dist > location.geoFenceRadius) {
          return {
            status: false,
            message: `You are too far from the location (${Math.round(dist)}m)`,
          };
        }
      }
    } else if (lat && lng) {
      // Find nearest
      const locations = await this.prisma.location.findMany({
        where: { status: 'active' },
        include: { pos: { where: { status: 'active' } } },
      });

      let minDistance = Infinity;
      let nearest: any = null;

      for (const loc of locations) {
        if (loc.latitude && loc.longitude) {
          const dist = this.calculateDistance(
            lat,
            lng,
            Number(loc.latitude),
            Number(loc.longitude),
          );
          if (dist < minDistance) {
            minDistance = dist;
            nearest = loc;
          }
        }
      }

      if (nearest) {
        // Check GeoConstraints on nearest
        if (nearest.geoFenceEnabled) {
          if (minDistance > nearest.geoFenceRadius) {
            return {
              status: false,
              message: 'No authorized location found nearby',
            };
          }
        }
        location = nearest;
      } else {
        return {
          status: false,
          message: 'No locations configured with coordinates',
        };
      }
    } else {
      return {
        status: false,
        message: 'Location Code or GPS Coordinates required',
      };
    }

    // IP Whitelist Check
    if (location.ipWhitelistEnabled && location.ipWhitelist) {
      const allowedIps = location.ipWhitelist.split(',').map((i) => i.trim());
      if (!allowedIps.includes(ip)) {
        return { status: false, message: 'Access denied from this IP address' };
      }
    }

    return {
      status: true,
      data: {
        location: {
          id: location.id,
          name: location.name,
          code: location.code,
        },
        terminals: location.pos.map((p) => ({
          id: p.id,
          name: p.name,
          code: p.terminalCode,
          status: p.status,
        })),
      },
    };
  }

  async posTerminalLogin(
    terminalCode: string,
    pin: string,
  ) {
    const validation = await this.posService.validateTerminal(terminalCode, pin);
    if (!validation.status || !validation.data) {
      return validation;
    }

    const { terminalId, name, companyId, company, tenant, posId, locationId, terminalCode: dbTerminalCode } = validation.data;

    // Create a specialized POS terminal token
    const accessOpts: jwt.SignOptions = {
      expiresIn: '8h', // POS terminals stay logged in for 8 hours (PIN requirement)
      issuer: authConfig.jwt.issuer,
    };

    const accessToken = jwt.sign(
      {
        terminalId,
        posId,
        locationId,
        companyId,
        tenantId: tenant?.id,
        roleName: 'POS_TERMINAL',
        isTerminal: true,
        terminalCode: dbTerminalCode,
      },
      authConfig.jwt.accessSecret,
      accessOpts,
    );

    // ── Check for existing active session ──
    // Determine which prisma client to use for session management
    let sessionPrisma: any = this.prisma;
    let tempPool: any = null;
    let isTemp = false;
    let session: any = null;

    if (!this.prisma.getTenantId()) {
      // If no context, we must create a temporary one for this specific company
      if (company?.dbUrl) {
        let dbUrl = company.dbUrl;
        let dbPassword = '';
        if (company.dbPassword) {
          try {
            dbPassword = this.encryptionService.decrypt(company.dbPassword);
          } catch (e) { }
        }

        try {
          tempPool = new Pool({
            user: company.dbUser || undefined,
            host: company.dbHost || undefined,
            database: company.dbName || undefined,
            password: dbPassword || undefined,
            port: company.dbPort || 5432,
            max: 1,
            connectionTimeoutMillis: 2000,
          });
          const adapter = new PrismaPg(tempPool);
          sessionPrisma = new PrismaClient({ adapter: adapter as any });
          isTemp = true;
        } catch (e) {
          this.logger.error(`Failed to create temporary session prisma: ${e.message}`);
        }
      }
    }

    try {
      session = await sessionPrisma.posSession.findFirst({
        where: { posId: terminalId, status: 'open' },
        orderBy: { openedAt: 'desc' },
      });

      if (!session) {
        // Create a new PosSession record
        session = await sessionPrisma.posSession.create({
          data: {
            posId: terminalId,
            status: 'open',
            token: accessToken,
          },
        });
      } else {
        // Update the existing session with the new token
        session = await sessionPrisma.posSession.update({
          where: { id: session.id },
          data: { token: accessToken },
        });
      }
    } finally {
      if (isTemp && sessionPrisma) {
        await sessionPrisma.$disconnect();
        if (tempPool) await tempPool.end();
      }
    }

    return {
      status: true,
      message: 'Terminal authenticated successfully',
      data: {
        terminal: {
          id: terminalId,
          posId,
          name,
        },
        company: {
          id: companyId,
          name: company?.name,
        },
        tenant: tenant ? {
          id: tenant.id,
          code: tenant.code,
          name: tenant.name,
        } : null,
        accessToken,
        sessionId: session.id,
      },
    };
  }

  async refresh(token: string) {
    try {
      const decoded = jwt.verify(token, authConfig.jwt.refreshSecret) as any;

      const user = await this.prismaMaster.user.findUnique({
        where: { id: decoded.userId },
        include: {
          role: { include: { permissions: { include: { permission: true } } } },
        },
      });
      if (!user || user.status !== 'active')
        return { status: false, message: 'User not found or inactive' };

      // Generate new access token
      const accessOpts: jwt.SignOptions = {
        expiresIn: authConfig.jwt.accessExpiresIn as any,
        issuer: authConfig.jwt.issuer,
      };
      const accessToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          roleId: user.roleId,
          employeeId: user.employeeId,
          roleName: user.role?.name || null,
          impersonatorId: decoded.impersonatorId,
          isImpersonating: decoded.isImpersonating,
          sessionId: decoded.sessionId, // Keep sessionId in the new access token
        },
        authConfig.jwt.accessSecret,
        accessOpts,
      );

      // Generate a new refresh token (Refresh Token Rotation)
      const refreshOpts: jwt.SignOptions = {
        expiresIn: authConfig.jwt.refreshExpiresIn as any,
        issuer: authConfig.jwt.issuer,
      };
      const newRefreshToken = jwt.sign(
        {
          userId: user.id,
          sessionId: decoded.sessionId,
          impersonatorId: decoded.impersonatorId,
          isImpersonating: decoded.isImpersonating
        },
        authConfig.jwt.refreshSecret,
        refreshOpts,
      );

      return {
        status: true,
        data: { accessToken, refreshToken: newRefreshToken },
      };
    } catch (error) {
      return { status: false, message: 'Invalid refresh token' };
    }
  }

  async me(userId: string) {
    let user = (await this.prismaMaster.user.findUnique({
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

    // Handle POS Terminal identity if not a regular user
    if (!user) {
      const terminal = await this.prisma.pos.findUnique({
        where: { id: userId },
        include: { location: true },
      });

      if (terminal) {
        user = {
          id: terminal.id,
          firstName: terminal.name,
          lastName: '(Terminal)',
          email: terminal.terminalCode,
          isTerminal: true,
          terminal: {
            id: terminal.id,
            code: terminal.terminalCode,
            name: terminal.name,
            location: terminal.location ? {
              id: terminal.location.id,
              name: terminal.location.name,
              code: terminal.location.code,
            } : null,
          },
          role: {
            name: 'POS_TERMINAL',
            permissions: [{ permission: { name: 'pos:*' } }],
          },
        };
      }
    }

    if (!user) return { status: false, message: 'Identity not found' };

    // Resolve employee details if prisma is available
    if (this.prisma) {
      try {
        const employee = await this.prisma.employee.findUnique({
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
            this.prisma.department.findUnique({
              where: { id: employee.departmentId || '' },
            }),
            this.prisma.designation.findUnique({
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

  async verifyPosSession(userId: string) {
    if (!this.prisma) return { status: false, message: 'Tenant database not available' };
    try {
      const activeSession = await this.prisma.posSession.findFirst({
        where: { userId, status: 'open' },
        orderBy: { updatedAt: 'desc' },
        include: { pos: { include: { location: true } } }
      });
      if (!activeSession) return { status: false, message: 'No active POS session found' };

      const terminal = activeSession.pos;
      if (!terminal || terminal.status !== 'active') {
        await this.prisma.posSession.update({
          where: { id: activeSession.id },
          data: { status: 'closed' }
        });
        return { status: false, message: 'POS terminal is deactivated or deleted. Session closed.' };
      }

      // Get full session metrics using PosSessionService
      const sessionStatus = await this.posSessionService.getCurrentSession(terminal.id, terminal.posId, terminal.locationId);

      return {
        status: true,
        message: 'POS Session is valid',
        data: {
          sessionId: activeSession.id,
          terminalId: terminal.id,
          terminalCode: terminal.terminalCode,
          locationCode: terminal.location?.code,
          locationId: terminal.locationId,
          isDrawerOpen: sessionStatus?.isDrawerOpen ?? false,
          metrics: sessionStatus?.metrics || null
        }
      };
    } catch (e) {
      return { status: false, message: 'Failed to verify POS session' };
    }
  }

  async logout(userId: string, accessToken?: string) {
    // Simply return success since there is no server-side token state to clear.
    // Cookies are cleared in the controller.
    return { status: true, message: 'Logged out' };
  }

  async checkSession(userId: string, accessToken?: string) {
    if (!userId) {
      return {
        status: false,
        message: 'No active user session',
        valid: false,
        resetCookies: true,
      };
    }

    const user = await this.prismaMaster.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      return {
        status: false,
        message: 'User not found',
        valid: false,
        resetCookies: true,
      };
    }
    if (user.status !== 'active')
      return {
        status: false,
        message: 'User is not active',
        valid: false,
        resetCookies: true,
      };

    return {
      status: true,
      message: 'Session is valid',
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

    // Resolve employee details if prisma is available
    if (this.prisma) {
      try {
        const employee = await this.prisma.employee.findUnique({
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
            this.prisma.department.findUnique({
              where: { id: employee.departmentId || '' },
            }),
            this.prisma.designation.findUnique({
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
    if (this.prisma) {
      const isInit = (this.prisma as any).isInitialized;
      this.logger.log(`getAllUsers: Prisma initialized=${isInit}`);

      try {
        const userIds = users.map((u) => u.id);
        const employeeIds = users
          .filter((u) => u.employeeId)
          .map((u) => u.employeeId) as string[];

        // Fetch employees by either userId (back-ref) or employeeId (direct-ref)
        const employees = await this.prisma.employee.findMany({
          where: {
            OR: [{ userId: { in: userIds } }, { id: { in: employeeIds } }],
          },
          select: {
            userId: true,
            id: true,
            employeeName: true,
            departmentId: true,
            designationId: true,
          },
        });

        // Map by both for maximum reliability
        const employeeByUserId = new Map(
          employees.filter((e) => e.userId).map((e) => [e.userId, e]),
        );
        const employeeByEmpId = new Map(employees.map((e) => [e.id, e]));

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
          this.prisma.department.findMany({
            where: { id: { in: deptIds } },
          }),
          this.prisma.designation.findMany({
            where: { id: { in: desgIds } },
          }),
        ]);

        const deptMap = new Map(departments.map((d) => [d.id, d.name]));
        const desgMap = new Map(designations.map((d) => [d.id, d.name]));

        for (const user of users) {
          // Try lookup by employeeId first (master link), then userId (tenant link)
          const emp =
            (user.employeeId ? employeeByEmpId.get(user.employeeId) : null) ||
            employeeByUserId.get(user.id);

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
        this.logger.error(`Failed to map employees in getAllUsers: ${err.message}`);
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

        // Sync to employee record in tenant DB if present
        if (data.employeeId && this.prisma) {
          try {
            await this.prisma.employee.update({
              where: { id: data.employeeId },
              data: { userId: updatedUser.id },
            });
          } catch (e) {
            this.logger.error(
              `Failed to sync userId to employee on update: ${e.message}`,
            );
          }
        }

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

    // Sync to employee record in tenant DB if present
    if (data.employeeId && this.prisma) {
      try {
        await this.prisma.employee.update({
          where: { id: data.employeeId },
          data: { userId: user.id },
        });
      } catch (e) {
        this.logger.error(
          `Failed to sync userId to employee on create: ${e.message}`,
        );
      }
    }

    return { status: true, data: user, message: 'User created successfully' };
  }

  async updateUser(id: string, data: any) {
    const user = await this.prismaMaster.user.update({ where: { id }, data });

    // Sync to employee record in tenant DB if employee link is being established/changed
    if (data.employeeId && this.prisma) {
      try {
        await this.prisma.employee.update({
          where: { id: data.employeeId },
          data: { userId: user.id },
        });
      } catch (e) {
        this.logger.error(`Failed to sync userId to employee on update: ${e.message}`);
      }
    }

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
      select: {
        roleId: true,
        role: {
          select: {
            permissions: {
              select: {
                permission: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (!user?.roleId || !user.role) return [];

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

  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const user = await this.prismaMaster.user.findUnique({
      where: { id: userId },
    });
    if (!user || !user.password) return false;
    return bcrypt.compare(password, user.password);
  }


  // Helper to detect device type from user agent
  private getDeviceType(userAgent?: string): string {
    if (!userAgent) return 'DESKTOP';
    const ua = userAgent.toLowerCase();
    const isMobile = /mobile|android|iphone|ipad|phone/i.test(ua);
    return isMobile ? 'MOBILE' : 'DESKTOP';
  }

  // Helper to manage concurrent sessions
  private async manageActiveSessions(
    userId: string,
    roleName: string,
    sessionToken: string,
    deviceInfo?: { ip?: string; userAgent?: string; deviceInfo?: string; browserId?: string }
  ): Promise<string> {
    // Normalize role name check
    const rName = roleName?.toLowerCase().trim() || '';
    const isAdmin = ['super_admin', 'super admin', 'admin'].includes(rName);
    const deviceType = this.getDeviceType(deviceInfo?.userAgent);

    if (isAdmin) {
      // Admins get 5 sessions total across any device
      const maxSessions = 5;
      const existingSessions = await this.prismaMaster.userSession.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' }
      });

      if (existingSessions.length >= maxSessions) {
        const toDeleteCount = existingSessions.length - maxSessions + 1;
        const toDeleteIds = existingSessions.slice(0, toDeleteCount).map(s => s.id);
        await this.prismaMaster.userSession.deleteMany({
          where: { id: { in: toDeleteIds } }
        });
      }
    } else {
      // Regular users get 1 Desktop and 1 Mobile session
      // We remove any existing session for THIS device type
      await this.prismaMaster.userSession.deleteMany({
        where: {
          userId,
          deviceType: deviceType
        }
      });
    }

    // Create new session
    const newSession = await this.prismaMaster.userSession.create({
      data: {
        userId,
        token: sessionToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        ipAddress: deviceInfo?.ip,
        userAgent: deviceInfo?.userAgent,
        deviceInfo: deviceInfo?.deviceInfo,
        browserId: deviceInfo?.browserId,
        deviceType: deviceType
      }
    });

    return newSession.id;
  }

  // Get all profiles associated with this browser
  async getAvailableProfiles(browserId: string) {
    if (!browserId) return [];

    const sessions = await this.prismaMaster.userSession.findMany({
      where: {
        browserId,
        expiresAt: { gt: new Date() }
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            avatar: true,
            status: true
          }
        }
      }
    });

    // Deduplicate users and filter active sessions
    const profiles = new Map();
    sessions.forEach(s => {
      if (!profiles.has(s.userId)) {
        profiles.set(s.userId, {
          ...s.user,
          lastActive: s.updatedAt,
          isActive: true
        });
      }
    });

    return Array.from(profiles.values());
  }

  async getUserSessions(userId: string) {
    const sessions = await this.prismaMaster.userSession.findMany({
      where: {
        userId,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        ipAddress: true,
        userAgent: true,
        deviceType: true,
        deviceInfo: true,
        createdAt: true,
        updatedAt: true,
        expiresAt: true,
      },
    });
    return { status: true, data: sessions };
  }

  async terminateSession(userId: string, sessionId: string) {
    const session = await this.prismaMaster.userSession.findFirst({
      where: { id: sessionId, userId },
    });
    if (!session) return { status: false, message: 'Session not found' };

    await this.prismaMaster.userSession.delete({ where: { id: sessionId } });
    return { status: true, message: 'Session terminated' };
  }

  async posUserLoginStandard(
    email: string,
    pass: string,
    context: { terminalId: string; posId: string; locationId: string; posSessionId?: string; tenantId: string },
    deviceInfo?: { ip?: string; userAgent?: string; deviceInfo?: string }
  ) {
    // ── 1. Verify user credentials & master-level checks ─────────────────────
    const user = await this.prismaMaster.user.findUnique({
      where: { email },
      include: { role: { include: { permissions: { include: { permission: true } } } } }
    });

    if (!user) return { status: false, message: 'Invalid credentials' };
    if (user.status !== 'active') return { status: false, message: 'Account is not active' };

    // Verify the user belongs to the same company/tenant as this terminal
    if (context.tenantId && user.tenantId !== context.tenantId) {
      return { status: false, message: 'You do not belong to this organization' };
    }

    const isValid = await bcrypt.compare(pass, user.password);
    if (!isValid) return { status: false, message: 'Invalid credentials' };

    // Verify POS Access
    const hasPosAccess = user.role?.isSystem || user.role?.permissions?.some(p => p.permission.module === 'POS');
    if (!hasPosAccess) {
      return { status: false, errorType: 'NO_POS_ACCESS', message: 'User does not have POS access.' };
    }

    // ── 2. Employee check in tenant DB (Bypassed for System Admins) ───────────
    // The user must be an active employee linked to this terminal's location
    if (!user.role?.isSystem && this.prisma && context.locationId) {
      let employee: any = null;

      // Primary lookup: by userId (direct link)
      if (user.id) {
        employee = await this.prisma.employee.findFirst({
          where: { userId: user.id },
          select: { id: true, locationId: true, status: true, employeeName: true }
        });
      }

      // Fallback: by employeeId string if the master User.employeeId is set
      if (!employee && user.employeeId) {
        employee = await this.prisma.employee.findFirst({
          where: { employeeId: user.employeeId },
          select: { id: true, locationId: true, status: true, employeeName: true }
        });
      }

      if (!employee) {
        return { status: false, message: 'No employee record found for this user in the system' };
      }

      if (employee.status !== 'active') {
        return { status: false, message: 'Your employee account is not active' };
      }

      // Check location assignment — must match this terminal's location
      if (employee.locationId && employee.locationId !== context.locationId) {
        return {
          status: false,
          message: `You are not assigned to this location. Please contact your administrator.`,
        };
      }

      // If locationId is null/unset on the employee, we allow it (unassigned = can log in anywhere)
      // You can tighten this by uncommenting the block below:
      if (!employee.locationId) {
        return { status: false, message: 'You have no location assigned. Contact admin.' };
      }
    }

    // ── 3. Link to POS session if one is active ───────────────────────────────
    if (context.posSessionId) {
      await this.prisma.posSession.update({
        where: { id: context.posSessionId },
        data: { userId: user.id },
      });
    }

    // ── 4. Issue combined POS + User access token ─────────────────────────────
    const sessionToken = uuidv4();
    const sessionId = await this.manageActiveSessions(user.id, user.role?.name || 'User', sessionToken, deviceInfo);

    const accessOpts: jwt.SignOptions = {
      expiresIn: '12h',
      issuer: authConfig.jwt.issuer,
    };

    const accessToken = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        roleId: user.roleId,
        employeeId: user.employeeId,
        roleName: user.role?.name || null,
        tenantId: user.tenantId,
        // POS context embedded in token
        terminalId: context.terminalId,
        posId: context.posId,
        locationId: context.locationId,
        posSessionId: context.posSessionId,
        isPosUser: true,
        sessionId,
      },
      authConfig.jwt.accessSecret,
      accessOpts,
    );

    await this.prismaMaster.loginHistory.create({
      data: {
        userId: user.id,
        ipAddress: deviceInfo?.ip || 'POS',
        userAgent: deviceInfo?.userAgent || 'POS Terminal',
        status: 'success',
      },
    });

    return {
      status: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role?.name || null,
          permissions: user.role?.permissions.map(p => p.permission.name) || [],
          email: user.email,
          isPosUser: true,
        },
        accessToken,
        sessionId,
      },
    };
  }

  async posUserLinkSession(
    userId: string,
    terminalToken: string,
    deviceInfo?: { ip?: string; userAgent?: string; deviceInfo?: string }
  ) {
    try {
      // Decode terminal token to get terminal/tenant context
      const terminalDecoded = jwt.verify(terminalToken, authConfig.jwt.accessSecret) as any;

      if (!terminalDecoded.isTerminal) {
        return { status: false, message: 'Invalid terminal token' };
      }

      const user = await this.prismaMaster.user.findUnique({
        where: { id: userId },
        include: { role: { include: { permissions: { include: { permission: true } } } } }
      });

      if (!user) return { status: false, message: 'User not found' };
      if (user.status !== 'active') return { status: false, message: 'Account is not active' };

      // Verify Tenant match
      if (user.tenantId !== terminalDecoded.tenantId) {
        return { status: false, message: 'User does not belong to this organization' };
      }

      // Verify POS Access
      const hasPosAccess = user.role?.isSystem || user.role?.permissions?.some(p => p.permission.module === 'POS');
      if (!hasPosAccess) {
        return { status: false, errorType: 'NO_POS_ACCESS', message: 'User does not have POS access. Please log in with a POS-authorized profile.' };
      }

      // ── Employee Location check in tenant DB (Bypassed for System Admins & Global ADMINs) ─
      const isGlobalAdmin = user.role?.isSystem || user.role?.name === 'ADMIN';

      if (!isGlobalAdmin && this.prisma && terminalDecoded.locationId) {
        let employee: any = null;

        if (user.id) {
          employee = await this.prisma.employee.findFirst({
            where: { userId: user.id },
            select: { id: true, locationId: true, status: true, employeeName: true }
          });
        }

        if (!employee && user.employeeId) {
          employee = await this.prisma.employee.findFirst({
            where: { employeeId: user.employeeId },
            select: { id: true, locationId: true, status: true, employeeName: true }
          });
        }

        if (employee) {
          if (employee.status !== 'active') {
            return { status: false, message: 'Your employee account is not active' };
          }
          if (employee.locationId && employee.locationId !== terminalDecoded.locationId) {
            return { status: false, message: 'You are not assigned to this location. Please contact your administrator.' };
          }
        }
      }

      // Find or create POS session
      let posSession = await this.prisma.posSession.findFirst({
        where: { posId: terminalDecoded.terminalId, status: 'open' },
        orderBy: { createdAt: 'desc' }
      });

      if (!posSession) {
        // Create if missing (though it should be created at terminal login)
        posSession = await this.prisma.posSession.create({
          data: {
            posId: terminalDecoded.terminalId,
            status: 'open',
            token: terminalToken,
            userId: user.id
          }
        });
      } else {
        await this.prisma.posSession.update({
          where: { id: posSession.id },
          data: { userId: user.id },
        });
      }

      // Generate User Session (Concurrent Limit)
      const sessionToken = uuidv4();
      const sessionId = await this.manageActiveSessions(user.id, user.role?.name || 'User', sessionToken, deviceInfo);

      // Create Combined Token
      const accessOpts: jwt.SignOptions = {
        expiresIn: '8h',
        issuer: authConfig.jwt.issuer,
      };

      const accessToken = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          roleId: user.roleId,
          employeeId: user.employeeId,
          roleName: user.role?.name || null,
          tenantId: user.tenantId,
          terminalId: terminalDecoded.terminalId,
          posId: terminalDecoded.posId,
          locationId: terminalDecoded.locationId,
          posSessionId: posSession.id,
          isPosUser: true,
          sessionId: sessionId,
        },
        authConfig.jwt.accessSecret,
        accessOpts,
      );

      return {
        status: true,
        message: 'Link successful',
        data: {
          user: {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role?.name || null,
            permissions: user.role?.permissions.map(p => p.permission.name) || [],
            email: user.email,
            isPosUser: true
          },
          accessToken,
          sessionId
        },
      };
    } catch (err) {
      console.error('POS Link Error:', err);
      return { status: false, message: 'Failed to link session' };
    }
  }
}
