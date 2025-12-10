import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common'
import { AuthService } from './auth.service'
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard'

@Controller('api/auth')
export class AuthController {
  constructor(private service: AuthService) {}

  @Post('login')
  async login(@Body() body: any) {
    const { email, password } = body
    return this.service.login(email, password)
  }

  @Post('refresh-token')
  async refresh(@Body('refreshToken') refreshToken: string) {
    return this.service.refresh(refreshToken)
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: any) {
    return this.service.me(req.user.userId)
  }

  @Get('check-session')
  @UseGuards(JwtAuthGuard)
  async check(@Req() req: any) {
    return this.service.checkSession(req.user.userId)
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req: any) {
    return this.service.logout(req.user.userId)
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  async changePassword(@Req() req: any, @Body() body: any) {
    return this.service.changePassword(req.user.userId, body.oldPassword, body.newPassword)
  }

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
  async sessions(@Req() req: any) {
    return this.service.getActiveSessions(req.user.userId)
  }

  @Post('sessions/terminate')
  @UseGuards(JwtAuthGuard)
  async terminate(@Req() req: any, @Body('sessionId') sessionId: string) {
    return this.service.terminateSession(req.user.userId, sessionId)
  }

  @Get('login-history')
  @UseGuards(JwtAuthGuard)
  async loginHistory(@Req() req: any) {
    return this.service.getLoginHistory(req.user.userId)
  }

  @Get('users')
  @UseGuards(JwtAuthGuard)
  async users() {
    return this.service.getAllUsers()
  }

  @Post('users/update')
  @UseGuards(JwtAuthGuard)
  async updateUser(@Body() body: any) {
    return this.service.updateUser(body.id, body.data)
  }

  @Get('roles')
  @UseGuards(JwtAuthGuard)
  async roles() {
    return this.service.getRoles()
  }

  @Get('permissions')
  @UseGuards(JwtAuthGuard)
  async permissions() {
    return this.service.getPermissions()
  }

  @Get('activity-logs')
  @UseGuards(JwtAuthGuard)
  async activityLogs() {
    return this.service.getAllActivityLogs()
  }
}
