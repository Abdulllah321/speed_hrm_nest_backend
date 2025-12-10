import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import * as bcrypt from 'bcrypt'
import * as jwt from 'jsonwebtoken'
import * as crypto from 'crypto'
import authConfig from '../config/auth.config'

function parseExpiryToMs(expiry: string) {
  const m = expiry.match(/^(\d+)([smhd])$/)
  if (!m) return 30 * 24 * 60 * 60 * 1000
  const v = parseInt(m[1])
  const unit = m[2]
  const mult: Record<string, number> = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 }
  return v * (mult[unit] || mult.d)
}

@Injectable()
export class AuthService {
  constructor(private prisma: PrismaService) {}

  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { email }, include: { role: { include: { permissions: { include: { permission: true } } } } } })
    if (!user) return { status: false, message: 'Invalid credentials' }
    if (user.status !== 'active') return { status: false, message: 'Account is not active' }
    const ok = await bcrypt.compare(password, user.password)
    if (!ok) return { status: false, message: 'Invalid credentials' }
    const accessOpts: jwt.SignOptions = { expiresIn: authConfig.jwt.accessExpiresIn as any, issuer: authConfig.jwt.issuer }
    const accessToken = jwt.sign({ userId: user.id, email: user.email, roleId: user.roleId }, authConfig.jwt.accessSecret, accessOpts)
    const family = crypto.randomUUID()
    const refreshOpts: jwt.SignOptions = { expiresIn: authConfig.jwt.refreshExpiresIn as any, issuer: authConfig.jwt.issuer }
    const refreshToken = jwt.sign({ userId: user.id, family }, authConfig.jwt.refreshSecret, refreshOpts)
    const refreshTokenExpiryMs = parseExpiryToMs(authConfig.jwt.refreshExpiresIn)
    await this.prisma.refreshToken.create({ data: { userId: user.id, token: refreshToken, family, expiresAt: new Date(Date.now() + refreshTokenExpiryMs) } })
    await this.prisma.session.create({ data: { userId: user.id, token: accessToken, isActive: true, ipAddress: null, userAgent: null, lastActivityAt: new Date(), expiresAt: new Date(Date.now() + (authConfig.security.sessionTimeout)) } })
    return { status: true, data: { user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role?.name || null, permissions: user.role?.permissions.map(p => p.permission.name) || [] }, accessToken, refreshToken } }
  }

  async refresh(token: string) {
    try {
      const decoded = jwt.verify(token, authConfig.jwt.refreshSecret) as any
      const stored = await this.prisma.refreshToken.findUnique({ where: { token } })
      if (!stored || stored.isRevoked || new Date() > stored.expiresAt) return { status: false, message: 'Invalid refresh token' }
      const user = await this.prisma.user.findUnique({ where: { id: decoded.userId } })
      if (!user || user.status !== 'active') return { status: false, message: 'User not found or inactive' }
      const refreshTokenExpiryMs = parseExpiryToMs(authConfig.jwt.refreshExpiresIn)
      await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { isRevoked: true } })
      const family = decoded.family
      const accessOpts: jwt.SignOptions = { expiresIn: authConfig.jwt.accessExpiresIn as any, issuer: authConfig.jwt.issuer }
      const accessToken = jwt.sign({ userId: user.id, email: user.email, roleId: user.roleId }, authConfig.jwt.accessSecret, accessOpts)
      const refreshOpts: jwt.SignOptions = { expiresIn: authConfig.jwt.refreshExpiresIn as any, issuer: authConfig.jwt.issuer }
      const newRefreshToken = jwt.sign({ userId: user.id, family }, authConfig.jwt.refreshSecret, refreshOpts)
      await this.prisma.refreshToken.create({ data: { userId: user.id, token: newRefreshToken, family, expiresAt: new Date(Date.now() + refreshTokenExpiryMs) } })
      return { status: true, accessToken, refreshToken: newRefreshToken }
    } catch {
      return { status: false, message: 'Invalid refresh token' }
    }
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { role: { include: { permissions: { include: { permission: true } } } } } })
    if (!user) return { status: false, message: 'User not found' }
    return { status: true, data: user }
  }

  async logout(userId: string) {
    await this.prisma.session.updateMany({ where: { userId, isActive: true }, data: { isActive: false } })
    await this.prisma.refreshToken.updateMany({ where: { userId, isRevoked: false }, data: { isRevoked: true } })
    return { status: true, message: 'Logged out' }
  }

  async checkSession(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) return { status: false, message: 'User not found' }
    return { status: true, data: { userId: user.id, email: user.email, roleId: user.roleId } }
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } })
    if (!user) return { status: false, message: 'User not found' }
    const ok = await bcrypt.compare(oldPassword, user.password)
    if (!ok) return { status: false, message: 'Invalid current password' }
    if ((newPassword || '').length < authConfig.password.minLength) return { status: false, message: `Password must be at least ${authConfig.password.minLength} characters` }
    const hashed = await bcrypt.hash(newPassword, authConfig.password.saltRounds)
    await this.prisma.user.update({ where: { id: userId }, data: { password: hashed } })
    return { status: true, message: 'Password changed' }
  }

  async getActiveSessions(userId: string) {
    const sessions = await this.prisma.session.findMany({ where: { userId, isActive: true }, orderBy: { lastActivityAt: 'desc' } })
    return { status: true, data: sessions }
  }

  async terminateSession(userId: string, sessionId: string) {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } })
    if (!session || session.userId !== userId) return { status: false, message: 'Session not found' }
    await this.prisma.session.update({ where: { id: sessionId }, data: { isActive: false } })
    return { status: true, message: 'Session terminated' }
  }

  async getLoginHistory(userId: string) {
    const logs = await this.prisma.loginHistory.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 })
    return { status: true, data: logs }
  }

  async getAllUsers() {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } })
    return { status: true, data: users }
  }

  async updateUser(id: string, data: any) {
    const user = await this.prisma.user.update({ where: { id }, data })
    return { status: true, data: user }
  }

  async getRoles() {
    const roles = await this.prisma.role.findMany({ orderBy: { name: 'asc' }, include: { permissions: { include: { permission: true } } } })
    return { status: true, data: roles }
  }

  async getPermissions() {
    const permissions = await this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { action: 'asc' }] })
    return { status: true, data: permissions }
  }

  async getAllActivityLogs() {
    const logs = await this.prisma.activityLog.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })
    return { status: true, data: logs }
  }
}
