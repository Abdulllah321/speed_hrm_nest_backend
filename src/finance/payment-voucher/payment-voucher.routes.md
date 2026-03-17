# Payment Voucher API Routes

## Base URL: `/api/finance/payment-vouchers`

### 1. Create Payment Voucher
- **POST** `/`
- **Body**: CreatePaymentVoucherDto
- **Response**: Created payment voucher with details

### 2. Get All Payment Vouchers (with pagination & filtering)
- **GET** `/`
- **Query Parameters**:
  - `type`: 'bank' | 'cash' (optional)
  - `status`: 'pending' | 'approved' | 'rejected' (optional)
  - `page`: number (default: 1)
  - `limit`: number (default: 10)
  - `search`: string (optional) - searches in pvNo, description, refBillNo
- **Response**: Paginated list with metadata

### 3. Get Next PV Number
- **GET** `/next-pv-number?type=bank|cash`
- **Response**: `{ nextPvNumber: "BPV-2026-0001" }`

### 4. Get Summary Statistics
- **GET** `/summary?type=bank|cash` (type optional)
- **Response**: 
```json
{
  "totalVouchers": 150,
  "pendingVouchers": 25,
  "approvedVouchers": 120,
  "totalAmount": 500000.00,
  "pendingAmount": 75000.00
}
```

### 5. Get Payment Voucher by ID
- **GET** `/:id`
- **Response**: Payment voucher with full details

### 6. Update Payment Voucher
- **PATCH** `/:id`
- **Body**: UpdatePaymentVoucherDto (partial)
- **Response**: Updated payment voucher

### 7. Update Status Only
- **PATCH** `/:id/status`
- **Body**: `{ status: "approved|rejected|pending", remarks?: "optional remarks" }`
- **Response**: Updated payment voucher

### 8. Delete Payment Voucher
- **DELETE** `/:id`
- **Response**: Deleted payment voucher

## Features Added:
- ✅ Pagination support
- ✅ Search functionality
- ✅ Status management
- ✅ Auto PV number generation
- ✅ Summary statistics
- ✅ Comprehensive validation
- ✅ Swagger documentation
- ✅ Error handling
- ✅ Supplier relationship support