# DriveSafe HRM Integration - Environment Variables

Add the following environment variables to your `.env` file for the DriveSafe integration:

```bash
# ============================================
# DriveSafe Integration Configuration
# ============================================

# SSO Configuration
# -----------------
# Shared secret for verifying JWT tokens from DriveSafe
DRIVESAFE_SSO_SECRET=your-shared-sso-secret-here

# Expected audience claim in SSO JWT (optional, defaults to 'hrm')
DRIVESAFE_SSO_AUDIENCE=hrm

# URL to redirect to after successful SSO login (optional, defaults to '/dashboard')
SSO_REDIRECT_URL=/dashboard

# URL to redirect to on SSO error (optional, if not set returns JSON error)
# SSO_ERROR_URL=/auth/error

# HMAC API Configuration
# ----------------------
# Shared secret for server-to-server HMAC authentication
DRIVESAFE_HMAC_SECRET=your-shared-hmac-secret-here
```

## DriveSafe Backend Configuration

DriveSafe backend needs to:

1. **For SSO**: Sign JWT tokens with `DRIVESAFE_SSO_SECRET` containing:
   ```json
   {
     "dealer_id": "dealer_12345",
     "dealer_name": "ABC Motors",
     "user_id": "user_67890",
     "name": "John Doe",
     "email": "john@abcmotors.com",
     "role": "manager",
     "iss": "drivesafe",
     "aud": "hrm",
     "exp": 1735689600
   }
   ```

2. **For HMAC APIs**: Include headers:
   - `X-Signature`: `HMAC_SHA256(METHOD + PATH + TIMESTAMP + BODY, SECRET)`
   - `X-Timestamp`: Unix timestamp in milliseconds
