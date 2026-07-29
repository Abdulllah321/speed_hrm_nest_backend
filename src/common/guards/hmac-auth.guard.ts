import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class HmacAuthGuard implements CanActivate {
  private readonly logger = new Logger(HmacAuthGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();

    const signature =
      (request.headers['x-signature'] as string) ||
      (request.headers['x-hmac-signature'] as string) ||
      (request.headers['authorization']?.startsWith('HMAC ')
        ? request.headers['authorization'].replace('HMAC ', '').trim()
        : null);

    if (!signature) {
      this.logger.warn('HMAC verification failed: Missing x-signature header');
      throw new UnauthorizedException('Missing HMAC signature header (x-signature)');
    }

    const timestamp =
      (request.headers['x-timestamp'] as string) ||
      (request.headers['x-hmac-timestamp'] as string) ||
      '';

    // Verify timestamp freshness if provided (max 5 minutes drift allowed)
    if (timestamp) {
      const requestTime = parseInt(timestamp, 10);
      const currentTime = Math.floor(Date.now() / 1000);
      const toleranceInSeconds = 300; // 5 minutes

      if (isNaN(requestTime) || Math.abs(currentTime - requestTime) > toleranceInSeconds) {
        this.logger.warn(`HMAC verification failed: Request timestamp drift too high (${timestamp})`);
        throw new UnauthorizedException('HMAC signature expired or invalid timestamp');
      }
    }

    // Extract center_id from query params or route params
    const centerId =
      (request.query?.center_id as string) ||
      (request.query?.centerId as string) ||
      (request.params?.center_id as string) ||
      '';

    const secretKey =
      process.env.HMAC_SECRET || 'hmac_secret_key_2026';

    // Construct data string to verify
    // If timestamp is present: "centerId:timestamp", else "centerId"
    const dataToSign = timestamp ? `${centerId}:${timestamp}` : `${centerId}`;

    const expectedSignature = crypto
      .createHmac('sha256', secretKey)
      .update(dataToSign)
      .digest('hex');

    const signatureBuffer = Buffer.from(signature.toLowerCase());
    const expectedBuffer = Buffer.from(expectedSignature.toLowerCase());

    if (
      signatureBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
      this.logger.warn(`HMAC verification failed for center_id: ${centerId}`);
      throw new UnauthorizedException('Invalid HMAC signature');
    }

    return true;
  }
}
