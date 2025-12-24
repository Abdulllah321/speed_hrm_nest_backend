import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiBody } from '@nestjs/swagger'
import { LoginDto, RefreshTokenDto, ChangePasswordDto } from './dto/login.dto'

@ApiTags('Auth')
@Controller('api/auth')
export class AuthController {
  constructor(private service: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Login user' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async login(@Body() body: LoginDto, @Req() req: any) {
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection?.remoteAddress
    const userAgent = req.headers['user-agent']
    return this.service.login(body.email, body.password, ipAddress, userAgent)
  }

  @Post('refresh-token')
  @ApiOperation({ summary: 'Refresh access token' })
  @ApiResponse({ status: 200, description: 'Token refreshed' })
  async refresh(@Body() body: RefreshTokenDto) {
    return this.service.refresh(body.refreshToken)
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current user profile' })
  async me(@Req() req: any) {
    return this.service.me(req.user.userId)
  }

  @Get('check-session')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Check session validity' })
  async check(@Req() req: any) {
    const authHeader = req.headers['authorization'] as string
    const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined
    return this.service.checkSession(req.user.userId, accessToken)
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Logout user' })
  async logout(@Req() req: any) {
    // Extract token from Authorization header to invalidate only this session
    const authHeader = req.headers['authorization'] as string
    const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined
    return this.service.logout(req.user.userId, accessToken)
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Change password' })
  async changePassword(@Req() req: any, @Body() body: ChangePasswordDto) {
    return this.service.changePassword(req.user.userId, body.oldPassword, body.newPassword)
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get active sessions' })
  async sessions(@Req() req: any) {
    return this.service.getActiveSessions(req.user.userId)
  }

  @Post('sessions/terminate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Terminate a session' })
  @ApiBody({ schema: { type: 'object', properties: { sessionId: { type: 'string', example: 'session-uuid' } } } })
  async terminate(@Req() req: any, @Body('sessionId') sessionId: string) {
    return this.service.terminateSession(req.user.userId, sessionId)
  }

  @Get('login-history')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get login history' })
  async loginHistory(@Req() req: any) {
    return this.service.getLoginHistory(req.user.userId)
  }

  @Get('users')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all users' })
  async users() {
    return this.service.getAllUsers()
  }

  @Post('users/update')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update user' })
  @ApiBody({ schema: { type: 'object', properties: { id: { type: 'string', example: 'uuid' }, data: { type: 'object' } } } })
  async updateUser(@Body() body: any) {
    return this.service.updateUser(body.id, body.data)
  }

  @Get('roles')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all roles' })
  async roles() {
    return this.service.getRoles()
  }

  @Get('permissions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get all permissions' })
  async permissions() {
    return this.service.getPermissions()
  }

  @Get('activity-logs')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get activity logs' })
  async activityLogs() {
    return this.service.getAllActivityLogs()
  }
}
