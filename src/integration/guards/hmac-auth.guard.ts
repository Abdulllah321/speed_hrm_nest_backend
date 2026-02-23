import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'crypto';

/**
 * HMAC Authentication Guard for DriveSafe Server-to-Server API calls.
 *
 * Expected Headers:
 * - X-Signature: HMAC-SHA256 signature of the request
 * - X-Timestamp: Unix timestamp (milliseconds) - must be within 5 minutes
 *
 * Signature Format:
 * HMAC_SHA256(HTTP_METHOD + PATH + TIMESTAMP + BODY, DRIVESAFE_HMAC_SECRET)
 */
@Injectable()
export class HmacAuthGuard implements CanActivate {
  private readonly logger = new Logger(HmacAuthGuard.name);
  private readonly MAX_TIME_DRIFT_MS = 5 * 60 * 1000; // 5 minutes

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    const signature = request.headers['x-signature'] as string;
    const timestamp = request.headers['x-timestamp'] as string;

    if (!signature || !timestamp) {
      this.logger.warn('Missing HMAC signature or timestamp headers');
      throw new UnauthorizedException('Missing authentication headers');
    }

    // Validate timestamp to prevent replay attacks
    const requestTime = parseInt(timestamp, 10);
    const now = Date.now();

    if (
      isNaN(requestTime) ||
      Math.abs(now - requestTime) > this.MAX_TIME_DRIFT_MS
    ) {
      this.logger.warn(`Request timestamp out of range: ${timestamp}`);
      throw new UnauthorizedException('Request timestamp expired or invalid');
    }

    // Reconstruct the signature
    const secret = process.env.DRIVESAFE_HMAC_SECRET;
    if (!secret) {
      this.logger.error('DRIVESAFE_HMAC_SECRET not configured');
      throw new UnauthorizedException('Server configuration error');
    }

    const method = request.method.toUpperCase();
    const path = request.url.split('?')[0]; // Remove query params
    const body = request.body ? JSON.stringify(request.body) : '';

    const payload = `${method}${path}${timestamp}${body}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature),
    );

    if (!isValid) {
      this.logger.warn('Invalid HMAC signature');
      throw new UnauthorizedException('Invalid signature');
    }

    this.logger.debug('HMAC authentication successful');
    return true;
  }
}
