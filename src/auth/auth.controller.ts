import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
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
  UpdateUserDto,
} from './dto/login.dto';

@ApiTags('Auth')
@Controller('api/auth')
export class AuthController {
  constructor(private service: AuthService) { }

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
        domain = '.localtest.me';
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

    return {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: 'lax' as const,
      domain,
      path: '/',
    };
  }

  @Post('login')
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async login(@Body() body: LoginDto, @Req() req: any, @Res() res: any) {
    const ipAddress =
      req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress;
    const userAgent = req.headers['user-agent'];
    const result = await this.service.login(
      body.email,
      body.password,
      ipAddress,
      userAgent,
    );

    if (result.status && result.data) {
      const cookieOptions = this.getCookieOptions(req);

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

      return res.send({
        status: true,
        message: 'Login successful',
        data: { user: result.data.user },
      });
    }

    return res.status(401).send({
      status: false,
      message: result.message || 'Login failed',
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

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async me(@Req() req: any) {
    return this.service.me(req.user.userId);
  }

  @Get('check-session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check session validity' })
  async check(@Req() req: any) {
    const authHeader = req.headers['authorization'] as string;
    const accessToken = authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : undefined;
    return this.service.checkSession(req.user.userId, accessToken);
  }

  @Post('update-profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update current user profile' })
  async updateProfile(@Req() req: any, @Body() body: UpdateUserDto) {
    return this.service.updateMe(req.user.userId, body);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout user' })
  async logout(@Req() req: any, @Res() res: any) {
    // Extract token from Authorization header to invalidate only this session
    const authHeader = req.headers['authorization'] as string;
    const accessToken = authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : undefined;
    await this.service.logout(req.user.userId, accessToken);

    const clearCookieOptions = this.getCookieOptions(req);

    res.clearCookie('accessToken', clearCookieOptions);
    res.clearCookie('refreshToken', clearCookieOptions);
    res.clearCookie('userRole', clearCookieOptions);
    res.clearCookie('user', clearCookieOptions);

    return res.send({
      status: true,
      message: 'Logged out successfully',
    });
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

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get active sessions' })
  async sessions(@Req() req: any) {
    return this.service.getActiveSessions(req.user.userId);
  }

  @Post('sessions/terminate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Terminate a session' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: { sessionId: { type: 'string', example: 'session-uuid' } },
    },
  })
  async terminate(@Req() req: any, @Body('sessionId') sessionId: string) {
    return this.service.terminateSession(req.user.userId, sessionId);
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
}
