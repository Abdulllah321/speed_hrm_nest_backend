import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common'
import * as jwt from 'jsonwebtoken'
import authConfig from '../../config/auth.config'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest()
    const authHeader = req.headers['authorization'] as string
    if (!authHeader || !authHeader.startsWith('Bearer ')) return false
    const token = authHeader.split(' ')[1]
    try {
      const decoded = jwt.verify(token, authConfig.jwt.accessSecret, { issuer: authConfig.jwt.issuer }) as any

      req.user = decoded
      return true
    } catch {
      return false
    }
  }
}
