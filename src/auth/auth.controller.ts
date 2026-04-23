import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PrismaMasterService } from '../database/prisma-master.service';
import { PrismaService } from '../database/prisma.service';

import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';

export const OptionalJwtAuth = () => SetMetadata('isOptional', true);
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';
import {
  LoginDto,
  RefreshTokenDto,
  ChangePasswordDto,
  UpdateUserProfileDto,
} from './dto/login.dto';

@ApiTags('Auth')
@Controller('api/auth')
export class AuthController {
  constructor(
    private service: AuthService,
    private prisma: PrismaService,
  ) { }

  private getCookieOptions(req: any) {
    const isProd = process.env.NODE_ENV === 'production';

    // Allow overriding secure cookies for local HTTP dev (e.g. *.localtest.me over http)
    const cookieSecure =
      process.env.COOKIE_SECURE !== undefined
        ? process.env.COOKIE_SECURE === 'true'
        : isProd;

    // Check Origin header first - this tells us where the request actually came from
    // (e.g., http://auth.localtest.me:3000)
    const origin = req?.headers?.origin || req?.headers?.referer || '';
    const originUrl = origin ? new URL(origin) : null;
    const originHost = originUrl?.hostname || '';

    // Extract parent domain from Origin (e.g., auth.localtest.me -> .localtest.me)
    let domain: string | undefined = undefined;

    // If COOKIE_DOMAIN is explicitly set, use it
    const domainFromEnv = process.env.COOKIE_DOMAIN?.trim();
    if (domainFromEnv) {
      domain = domainFromEnv;
    } else if (originHost) {
      // Extract parent domain from Origin (e.g., auth.localtest.me -> .localtest.me)
      // or subdomain.localtest.me -> .localtest.me
      if (originHost.includes('.localtest.me')) {
        // Only set domain if we are NOT on localhost (localhost cannot set cookies for .localtest.me)
        const currentHost = String(req?.hostname || '');
        if (
          !currentHost.includes('localhost') &&
          !currentHost.startsWith('127.')
        ) {
          domain = '.localtest.me';
        }
      } else if (originHost.includes('localhost')) {
        // If Origin is localhost, don't set domain (cookie will be for localhost only)
        domain = undefined;
      }
    } else {
      // Fallback: check req.hostname if Origin is not available
      const host = String(req?.hostname || '');
      const isLocalhost =
        host.includes('localhost') ||
        host.startsWith('127.') ||
        host.startsWith('0.0.0.0');

      if (!isLocalhost && host.includes('.localtest.me')) {
        domain = '.localtest.me';
      }
    }

    // Safety check: If we are running on localhost/127.0.0.1, we CANNOT set a custom domain
    // like .localtest.me because the browser will reject the cookie.
    // We must force domain to undefined (host-only) in this case.
    const currentHost = String(req?.hostname || '');
    if (
      currentHost.includes('localhost') ||
      currentHost.startsWith('127.') ||
      currentHost.startsWith('0.0.0.0')
    ) {
      domain = undefined;
    }

    const options = {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'lax' as const,
      domain,
      path: '/',
    };
    return options;
  }

  @Post('login')
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async login(@Body() body: LoginDto, @Req() req: any, @Res() res: any) {
    const ipAddress =
      req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Get Browser ID from cookie or generate new one
    let browserId = req.cookies?.bid;
    const cookieOptions = this.getCookieOptions(req);

    const result = await this.service.login(
      body.email,
      body.password,
      ipAddress,
      userAgent,
      browserId
    );

    if (result.status && result.data) {
      // If no browserId existed, set one now
      if (!browserId) {
        browserId = uuidv4();
        res.setCookie('bid', browserId, {
          ...cookieOptions,
          maxAge: 365 * 24 * 60 * 60 * 10, // 10 years
        });
      }

      // Set access token (7 days to match JWT expiry)
      res.setCookie('accessToken', result.data.accessToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      });

      // Set refresh token (30 days)
      res.setCookie('refreshToken', result.data.refreshToken, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
      });

      // Set user role for middleware
      res.setCookie('userRole', result.data.user.role || '', {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60,
      });

      // Set user data (for client-side access)
      res.setCookie('user', JSON.stringify(result.data.user), {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60,
      });

      // Set session ID
      res.setCookie('sessionId', result.data.sessionId, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60,
      });

      return res.send({
        status: true,
        message: 'Login successful',
        data: {
          user: result.data.user,
          sessionId: result.data.sessionId
        },
      });
    }

    return res.status(401).send({
      status: false,
      message: result.message || 'Login failed',
    });
  }

  @Post('pos/context')
  @ApiOperation({ summary: 'Get POS Login Context' })
  async getPosContext(@Body() body: any, @Req() req: any, @Res() res: any) {
    const ipAddress =
      req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;

    const result = await this.service.getPosLoginContext(
      ipAddress,
      body.code,
      body.lat,
      body.lng,
    );

    if (result.status) {
      return res.status(200).send(result);
    }
    return res.status(400).send(result);
  }

  @Post('pos/global-context')
  @ApiOperation({ summary: 'Get POS Login Context across all Tenants' })
  async getGlobalPosContext(@Body() body: { code: string }, @Req() req: any, @Res() res: any) {
    const ipAddress =
      req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;

    const result = await this.service.getGlobalPosLoginContext(ipAddress, body.code);

    if (result.status) {
      return res.status(200).send(result);
    }
    return res.status(400).send(result);
  }

  @Post('pos-login')
  @OptionalJwtAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Login for POS Terminal' })
  @ApiResponse({ status: 200, description: 'POS Terminal Login successful' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async posLogin(
    @Body() body: { terminalCode: string, pin: string },
    @Req() req: any,
    @Res() res: any,
  ) {
    // 1. Verify Terminal PIN
    const validation = await this.service.posTerminalLogin(
      body.terminalCode,
      body.pin,
    );

    if (!validation.status || !validation.data) {
      return res.status(401).send(validation);
    }

    const terminalData = validation.data as any;

    // 2. Set strict terminal-only token (posTerminalToken)
    // This token proves the DEVICE is a registered, trusted POS screen.
    const cookieOptions = this.getCookieOptions(req);
    res.setCookie('posTerminalToken', terminalData.accessToken, {
      ...cookieOptions,
      maxAge: 365 * 24 * 60 * 60 // 1 year cookie for physical terminal registration 
    });

    return res.send(validation);
  }

  @Post('pos/user-login')
  @OptionalJwtAuth()
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Login a user into an already-authenticated POS terminal' })
  async posUserLogin(
    @Body() body: { email: string; password: string },
    @Req() req: any,
    @Res() res: any,
  ) {
    const posTerminalToken = req.cookies?.['posTerminalToken'];
    if (!posTerminalToken) {
      return res.status(401).send({ status: false, message: 'Terminal not authenticated. Complete the terminal setup first.' });
    }

    let terminalContext: any;
    try {
      const jwt = require('jsonwebtoken');
      terminalContext = jwt.decode(posTerminalToken);
    } catch {
      return res.status(401).send({ status: false, message: 'Could not decode terminal session.' });
    }

    if (!terminalContext || !terminalContext.terminalId) {
      return res.status(401).send({ status: false, message: 'Invalid terminal context.' });
    }

    const terminalSession = await this.prisma.posSession.findFirst({
      where: { posId: terminalContext.terminalId, status: 'open' },
      orderBy: { createdAt: 'desc' },
    });

    if (!terminalSession?.token) {
      return res.status(401).send({ status: false, message: 'Terminal session not found or expired. Please re-setup terminal.' });
    }

    const context = {
      terminalId: terminalContext.terminalId,
      posId: terminalContext.posId || terminalContext.terminalId,
      locationId: terminalContext.locationId || '',
      posSessionId: terminalSession.id,
      tenantId: terminalContext.tenantId || '',
    };

    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceInfo = { ip: ipAddress, userAgent, deviceInfo: req.headers['sec-ch-ua'] || 'POS Terminal' };

    const result = await this.service.posUserLoginStandard(body.email, body.password, context, deviceInfo);

    if (result.status && result.data) {
      const cookieOptions = this.getCookieOptions(req);
      res.setCookie('accessToken', result.data.accessToken, { ...cookieOptions, maxAge: 12 * 60 * 60 });
      res.setCookie('user', JSON.stringify(result.data.user), { ...cookieOptions, maxAge: 12 * 60 * 60 });
      res.setCookie('userRole', result.data.user.role || '', { ...cookieOptions, maxAge: 12 * 60 * 60 });
      return res.send(result);
    }

    return res.status(401).send(result);
  }

  @Post('pos/switch-session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Link an active user session to a POS terminal' })
  async posSwitchSession(@Req() req: any, @Res() res: any) {
    const posTerminalToken = req.cookies?.['posTerminalToken'];
    if (!posTerminalToken) {
      return res.status(401).send({ status: false, message: 'Terminal not authenticated' });
    }

    let terminalContext: any;
    try {
      const jwt = require('jsonwebtoken');
      terminalContext = jwt.decode(posTerminalToken);
    } catch {
      return res.status(401).send({ status: false, message: 'Could not decode terminal session.' });
    }

    const terminalSession = await this.prisma.posSession.findFirst({
      where: { posId: terminalContext?.terminalId, status: 'open' },
      orderBy: { createdAt: 'desc' }
    });

    if (!terminalSession || !terminalSession.token) {
      return res.status(401).send({ status: false, message: 'Terminal session not found' });
    }

    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const deviceInfo = { ip: ipAddress, userAgent, deviceInfo: req.headers['sec-ch-ua'] || 'POS Terminal' };

    const result = await this.service.posUserLinkSession(req.user.userId || req.user.id, terminalSession.token, deviceInfo);

    if (result.status && result.data) {
      const cookieOptions = this.getCookieOptions(req);
      res.setCookie('accessToken', result.data.accessToken, { ...cookieOptions, maxAge: 12 * 60 * 60 });
      res.setCookie('user', JSON.stringify(result.data.user), { ...cookieOptions, maxAge: 12 * 60 * 60 });
      res.setCookie('userRole', result.data.user.role || '', { ...cookieOptions, maxAge: 12 * 60 * 60 });

      return res.send(result);
    }
    return res.status(400).send(result);
  }

  /**
   * SSO endpoint for DriveSafe integration.
   * Receives JWT token, validates it, provisions tenant/user if needed,
   * creates session, and redirects to dashboard.
   */
  @Get('sso')
  @ApiOperation({ summary: 'SSO login via DriveSafe JWT' })
  @ApiResponse({ status: 302, description: 'Redirect to dashboard on success' })
  @ApiResponse({ status: 401, description: 'Invalid or expired token' })
  async ssoLogin(
    @Query('token') token: string,
    @Req() req: any,
    @Res() res: any,
  ) {
    if (!token) {
      return res.status(400).send({
        status: false,
        message: 'SSO token is required',
      });
    }

    const ipAddress =
      req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await this.service.ssoLogin(token, ipAddress, userAgent);

    if (result.status && result.data) {
      const cookieOptions = this.getCookieOptions(req);

      // Set access token
      res.setCookie('accessToken', result.data.accessToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60, // 7 days
      });

      // Set refresh token
      res.setCookie('refreshToken', result.data.refreshToken, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60, // 30 days
      });

      // Set user role for middleware
      res.setCookie('userRole', result.data.user.role || '', {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60,
      });

      // Set tenant code for TenantMiddleware
      res.setCookie('tenantCode', result.data.tenant.code, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60,
      });

      // Set user data (for client-side)
      res.setCookie('user', JSON.stringify(result.data.user), {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60,
      });

      // Return JSON response for frontend to handle
      return res.send({
        status: true,
        message: 'SSO login successful',
        data: {
          user: result.data.user,
          tenant: result.data.tenant,
        },
      });
    }

    // SSO failed - return error JSON
    return (res as any).status(401).send({
      status: false,
      message: result.message || 'SSO authentication failed',
    });
  }

  @Post('impersonate-by-employee')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Impersonate a user by employeeId (admin only)' })
  async impersonateByEmployee(
    @Req() req: any,
    @Res() res: any,
    @Body('employeeId') employeeId: string,
  ) {
    const ipAddress =
      req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];

    const result = await this.service.impersonateByEmployee(
      req.user.userId,
      employeeId,
      ipAddress,
      userAgent,
    );

    if (result.status && result.data) {
      const cookieOptions = this.getCookieOptions(req);

      // Set access token
      res.setCookie('accessToken', result.data.accessToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60,
      });

      // Set refresh token
      res.setCookie('refreshToken', result.data.refreshToken, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60,
      });

      // Set user role
      res.setCookie('userRole', result.data.user.role || '', {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60,
      });

      // Set user summary data
      res.setCookie('user', JSON.stringify(result.data.user), {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60,
      });

      return res.send({
        status: true,
        message: 'Impersonation successful',
        data: { user: result.data.user },
      });
    }

    return res.status(400).send({
      status: false,
      message: result.message || 'Failed to impersonate user',
    });
  }

  @Post('stop-impersonating')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Stop impersonating and return to original admin session' })
  async stopImpersonating(@Req() req: any, @Res() res: any) {
    if (!req.user.isImpersonating || !req.user.impersonatorId) {
      return res.status(400).send({
        status: false,
        message: 'You are not currenty impersonating anyone',
      });
    }

    const result = await this.service.stopImpersonating(req.user.impersonatorId);

    if (result.status && result.data) {
      const cookieOptions = this.getCookieOptions(req);

      // Set access token
      res.setCookie('accessToken', result.data.accessToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60,
      });

      // Set refresh token
      res.setCookie('refreshToken', result.data.refreshToken, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60,
      });

      // Set user role
      res.setCookie('userRole', result.data.user.role || '', {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60,
      });

      // Set user summary data
      res.setCookie('user', JSON.stringify(result.data.user), {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60,
      });

      return res.send({
        status: true,
        message: 'Returned to original session',
        data: { user: result.data.user },
      });
    }

    return res.status(400).send({
      status: false,
      message: result.message || 'Failed to stop impersonating',
    });
  }

  @Post('refresh-token')
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed' })
  async refresh(
    @Body() body: RefreshTokenDto,
    @Req() req: any,
    @Res() res: any,
  ) {
    // Get refresh token from body or cookie
    const refreshToken = body.refreshToken || req.cookies?.['refreshToken'];

    if (!refreshToken) {
      return res.status(400).send({
        status: false,
        message: 'Refresh token is required',
      });
    }

    const result = await this.service.refresh(refreshToken);

    if (result.status && result.data) {
      const cookieOptions = this.getCookieOptions(req);

      // Update access token
      res.setCookie('accessToken', result.data.accessToken, {
        ...cookieOptions,
        maxAge: 7 * 24 * 60 * 60,
      });

      // Update refresh token
      res.setCookie('refreshToken', result.data.refreshToken, {
        ...cookieOptions,
        maxAge: 30 * 24 * 60 * 60,
      });

      return res.send({
        status: true,
        message: 'Token refreshed successfully',
      });
    }

    return res.status(401).send({
      status: false,
      message: result.message || 'Token refresh failed',
    });
  }

  @Get('permissions/lightweight')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user permissions (lightweight)' })
  async getMyPermissions(@Req() req: any) {
    const userId = req.user.id || req.user.userId;
    const permissions = await this.service.getUserPermissions(userId);
    const roleName = req.user.roleName || null;
    return { status: true, data: { permissions, role: roleName } };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async me(@Req() req: any) {
    const result = await this.service.me(req.user.id || req.user.userId);
    if (result.status && result.data) {

      let terminalId = req.user.terminalId;
      let locationId = req.user.locationId;
      let isPosUser = req.user.isPosUser;

      // Extract raw POS Terminal reality straight from the browser's persistent device cookie
      const posTerminalToken = req.cookies?.['posTerminalToken'];
      if (posTerminalToken) {
        try {
          const jwt = require('jsonwebtoken');
          const decoded = jwt.decode(posTerminalToken);
          if (decoded && decoded.terminalId) {
            terminalId = decoded.terminalId;
            locationId = decoded.locationId;
            isPosUser = true;
          }
        } catch { } // Ignore decoding errors
      }

      // Enrich with POS context
      if (isPosUser && terminalId) {
        (result.data as any).isPosUser = true;
        (result.data as any).terminalId = terminalId;
        (result.data as any).locationId = locationId;

        if (this.prisma) {
          try {
            const terminalRaw = await this.prisma.pos.findUnique({
              where: { id: terminalId },
              include: { location: true },
            });
            if (terminalRaw) {
              (result.data as any).terminal = {
                id: terminalRaw.id,
                code: terminalRaw.terminalCode,
                name: terminalRaw.name,
                location: terminalRaw.location ? {
                  id: terminalRaw.location.id,
                  code: terminalRaw.location.code,
                  name: terminalRaw.location.name,
                } : null
              };
            }
          } catch (e) { }
        }
      }
      // Enrich with impersonation context from current token
      if (req.user.isImpersonating) {
        (result.data as any).isImpersonating = true;
        (result.data as any).impersonatorId = req.user.impersonatorId;
      }
    }
    return result;
  }

  @Get('check-session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check session validity' })
  async check(@Req() req: any) {
    const authHeader = req.headers['authorization'] as string;
    const accessToken = authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : req.cookies?.['accessToken'];
    return this.service.checkSession(req.user.userId, accessToken);
  }

  @Get('pos/verify-session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify POS Session validity' })
  async verifyPosSession(@Req() req: any) {
    return this.service.verifyPosSession(req.user.userId || req.user.id);
  }

  @Post('update-profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user profile' })
  async updateProfile(@Req() req: any, @Body() body: UpdateUserProfileDto) {
    return this.service.updateMe(req.user.userId, body);
  }

  @Post('logout')
  @OptionalJwtAuth()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout current user — preserves posTerminalToken so the device stays registered' })
  async logout(@Req() req: any, @Res() res: any) {
    const clearCookieOptions = this.getCookieOptions(req);

    // Clear user session cookies only — posTerminalToken intentionally preserved
    // so the physical terminal device stays registered after a cashier switch.
    res.clearCookie('accessToken', clearCookieOptions);
    res.clearCookie('refreshToken', clearCookieOptions);
    res.clearCookie('userRole', clearCookieOptions);
    res.clearCookie('user', clearCookieOptions);
    res.clearCookie('posSessionId', clearCookieOptions);
    res.clearCookie('sessionId', clearCookieOptions);
    res.clearCookie('terminal', clearCookieOptions);
    res.clearCookie('terminalId', clearCookieOptions);
    res.clearCookie('currentCompany', clearCookieOptions);
    res.clearCookie('companyCode', clearCookieOptions);
    res.clearCookie('companyId', clearCookieOptions);
    res.clearCookie('bid', clearCookieOptions);
    res.clearCookie('tenantCode', clearCookieOptions);
    res.clearCookie('tenantId', clearCookieOptions);

    return res.send({ status: true, message: 'Logged out successfully' });
  }

  @Post('pos/logout-terminal')
  @OptionalJwtAuth()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Fully deregister this POS terminal device — clears posTerminalToken' })
  async logoutTerminal(@Req() req: any, @Res() res: any) {
    const clearCookieOptions = this.getCookieOptions(req);

    // Clear everything including the terminal device token
    res.clearCookie('accessToken', clearCookieOptions);
    res.clearCookie('refreshToken', clearCookieOptions);
    res.clearCookie('userRole', clearCookieOptions);
    res.clearCookie('user', clearCookieOptions);
    res.clearCookie('posSessionId', clearCookieOptions);
    res.clearCookie('sessionId', clearCookieOptions);
    res.clearCookie('terminal', clearCookieOptions);
    res.clearCookie('terminalId', clearCookieOptions);
    res.clearCookie('currentCompany', clearCookieOptions);
    res.clearCookie('companyCode', clearCookieOptions);
    res.clearCookie('companyId', clearCookieOptions);
    res.clearCookie('posTerminalToken', clearCookieOptions); // ← deregisters the device
    res.clearCookie('bid', clearCookieOptions);
    res.clearCookie('tenantCode', clearCookieOptions);
    res.clearCookie('tenantId', clearCookieOptions);

    return res.send({ status: true, message: 'Terminal deregistered successfully' });
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password' })
  async changePassword(@Req() req: any, @Body() body: ChangePasswordDto) {
    return this.service.changePassword(
      req.user.userId,
      body.oldPassword,
      body.newPassword,
    );
  }

  @Get('login-history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get login history' })
  async loginHistory(@Req() req: any) {
    return this.service.getLoginHistory(req.user.userId);
  }

  @Get('users')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all users' })
  async users() {
    return this.service.getAllUsers();
  }

  @Post('users')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create user' })
  async createUser(@Body() body: any) {
    return this.service.createUser(body);
  }

  @Post('users/update')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string', example: 'uuid' },
        data: { type: 'object' },
      },
    },
  })
  async updateUser(@Body() body: any) {
    return this.service.updateUser(body.id, body.data);
  }

  @Get('roles')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all roles' })
  async roles() {
    return this.service.getRoles();
  }

  @Get('permissions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all permissions' })
  async permissions() {
    return this.service.getPermissions();
  }

  @Get('activity-logs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get activity logs' })
  async activityLogs() {
    return this.service.getAllActivityLogs();
  }

  @Post('verify-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Verify current user password' })
  async verifyPassword(@Req() req: any, @Body() body: { password: string }) {
    const isValid = await this.service.verifyPassword(req.user.userId, body.password);
    return { status: isValid, message: isValid ? 'Password verified' : 'Invalid password' };
  }

  @Get('profiles')
  @ApiOperation({ summary: 'Get all active profiles on this browser' })
  async getProfiles(@Req() req: any) {
    const browserId = req.cookies?.bid;
    if (!browserId) return { status: true, data: [] };
    const profiles = await this.service.getAvailableProfiles(browserId);
    return { status: true, data: profiles };
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get active sessions for the current user' })
  async getSessions(@Req() req: any) {
    return this.service.getUserSessions(req.user.userId);
  }

  @Post('sessions/terminate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Terminate a specific session by ID' })
  async terminateSession(@Req() req: any, @Body('sessionId') sessionId: string, @Res() res: any) {
    const result = await this.service.terminateSession(req.user.userId, sessionId);
    return res.status(result.status ? 200 : 400).send(result);
  }
}
