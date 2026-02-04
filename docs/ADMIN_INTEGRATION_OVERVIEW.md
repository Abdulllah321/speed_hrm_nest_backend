# DriveSafe HRM Integration - Admin Overview

This document explains how the integration works internally and what you need to configure.

## 1. System Architecture Flow

The integration bridges DriveSafe dealers with your Multi-Tenant HRM. It is designed to be fully automated ("Just-In-Time" provisioning).

```mermaid
sequenceDiagram
    participant Dealer as DriveSafe Dealer
    participant HRM as HRM Backend
    participant MasterDB as Master Database
    participant TenantDB as Tenant Databases (Postgres)

    Note over Dealer,HRM: 1. SSO Login Attempt
    Dealer->>HRM: Hits /api/auth/sso?token=JWT
    HRM->>HRM: Verifies JWT Signature (using Secret)

    Note over HRM,TenantDB: 2. Auto-Provisioning (If New)
    HRM->>MasterDB: Checks if Tenant exists for Dealer ID
    alt Tenant Does Not Exist
        HRM->>HRM: Calculates unique DB Name & User
        HRM->>TenantDB: PROVISIONS New Physical Database
        HRM->>TenantDB: Runs Database Migrations (Schema Setup)
        HRM->>MasterDB: Creates Tenant & Company Records
    end

    Note over HRM,MasterDB: 3. Session Creation
    HRM->>MasterDB: Creates/Updates User Record
    HRM->>Dealer: Redirects to Dashboard (Logged In)
```

### Key Concepts
- **JIT Provisioning**: You don't need to manually create companies for dealers. When a new dealer clicks the link in DriveSafe, the system automatically creates a dedicated database for them (via `CompanyService`).
- **Isolation**: Every dealer gets their own physical PostgreSQL database, ensuring strict data privacy.
- **SSO Only**: Dealer users log in via DriveSafe. They do not have local passwords.

---

## 2. Environment Configuration

To enable this, you must add the following variables to your production `.env` file.

### Secrets (Must match what you give DriveSafe)
These are security keys. Generate random strings for these.
```bash
# Verify DriveSafe's SSO tokens
DRIVESAFE_SSO_SECRET=generate-a-long-random-secret-here

# Verify DriveSafe's API requests
DRIVESAFE_HMAC_SECRET=generate-another-long-random-secret-here
```

### Configuration
```bash
# Expected audience in their JWT (default: hmac)
DRIVESAFE_SSO_AUDIENCE=hrm

# Redirect URL after successful login
SSO_REDIRECT_URL=https://hrm.your-domain.com/dashboard

# Redirect URL if SSO fails (optional)
SSO_ERROR_URL=https://hrm.your-domain.com/auth/error
```

---

## 3. Managing Integration
You can use the new Integration APIs to manage this, but usually, it's automatic.
- **Deactivation**: If a dealer stops paying DriveSafe, DriveSafe can call the Deactivate API. This instantly locks the tenant and all its users in your system.
- **Manual Control**: You can still see these companies in your Super Admin panel. They appear as regular companies but with an extra "External ID" link.
