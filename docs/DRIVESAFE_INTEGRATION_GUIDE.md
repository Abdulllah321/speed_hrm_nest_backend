# DriveSafe Integration Guide

This guide details how the DriveSafe platform should integrate with the HRM SaaS.

## 1. Authentication & Security

There are two primary integration points:
1.  **Server-to-Server APIs (HMAC)**: For backend provisioning of dealers and users.
2.  **Single Sign-On (SSO)**: For logging dealers into the HRM dashboard.

### Shared Secrets
You will be provided with two secrets. Keep them secure!
- `DRIVESAFE_HMAC_SECRET`: Used to sign server-to-server API requests.
- `DRIVESAFE_SSO_SECRET`: Used to sign SSO JWT tokens.

---

## 2. Single Sign-On (SSO)

To log a dealer user into the HRM, generate a JWT and redirect them to the SSO endpoint.

**Endpoint:** `GET https://hrm.your-domain.com/api/auth/sso?token=<JWT_TOKEN>`

### JWT Payload Structure
Sign the JWT using HS256 and the `DRIVESAFE_SSO_SECRET`.

```json
{
  "dealer_id": "dealer_123",      // Unique Dealer ID (Required)
  "dealer_name": "ABC Motors",    // Dealer Business Name
  "user_id": "user_456",          // Unique User ID (Required)
  "name": "John Doe",             // User Full Name
  "email": "john@example.com",    // User Email (Required)
  "role": "manager",              // Optional: 'admin', 'manager', 'editor'
  "iss": "drivesafe",             // Issuer
  "aud": "hrm",                   // Audience
  "exp": 1735689600               // Expiration Timestamp
}
```

### Flow
1. User clicks "Open HRM" in DriveSafe.
2. DriveSafe backend generates a signed JWT.
3. User is redirected to `/api/auth/sso?token=JWT`.
4. HRM validates token. If valid:
   - **Just-In-Time Provisioning**: If the dealer or user doesn't exist, they are auto-created, and a dedicated database is provisioned instantly.
   - User is logged in and redirected to their dashboard.

---

## 3. Server-to-Server Provisioning APIs

Use these APIs to pre-provision dealers or push updates (e.g., deactivations) from your backend.

### Authentication (HMAC Headers)
All requests must include the following headers:

- `X-Timestamp`: Current Unix timestamp in milliseconds.
- `X-Signature`: HMAC-SHA256 signature.

**Signature Generation Algorithm:**
```javascript
const signature = hmac_sha256(
    method + path + timestamp + JSON.stringify(body), 
    DRIVESAFE_HMAC_SECRET
);
```
*(Note: `method` is uppercase, e.g., 'POST'. `path` is the API path, e.g., '/api/integration/tenants')*

### Endpoints

#### 1. Provision/Update Tenant (Dealer)
`POST /api/integration/tenants`

**Body:**
```json
{
  "externalId": "dealer_123",  // DriveSafe Dealer ID (Required)
  "name": "ABC Motors",        // Business Name
  "code": "abc-motors",        // Optional: specific URL code
  "isActive": true
}
```

#### 2. Provision/Update User
`POST /api/integration/users`

**Body:**
```json
{
  "externalId": "user_456",     // DriveSafe User ID (Required)
  "dealerId": "dealer_123",     // Link to Dealer (Required)
  "email": "john@example.com",
  "firstName": "John",
  "lastName": "Doe",
  "role": "manager",
  "isActive": true
}
```

#### 3. Deactivate Tenant
`POST /api/integration/tenants/deactivate`

**Body:**
```json
{
  "externalId": "dealer_123"
}
```
*This immediately disables access for the dealer and all their users.*
