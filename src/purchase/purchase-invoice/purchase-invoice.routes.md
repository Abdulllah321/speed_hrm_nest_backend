# Purchase Invoice API Routes

## Base URL: `/api/purchase/purchase-invoices`

### 1. Create Purchase Invoice
- **POST** `/`
- **Body**: CreatePurchaseInvoiceDto
- **Features**: 
  - Validates GRN/Landed Cost availability
  - Calculates totals automatically
  - Checks quantity limits
  - Prevents duplicate invoice numbers

### 2. Get All Purchase Invoices (with pagination & filtering)
- **GET** `/`
- **Query Parameters**:
  - `page`: number (default: 1)
  - `limit`: number (default: 10)
  - `supplierId`: string (optional)
  - `status`: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'CANCELLED' (optional)
  - `paymentStatus`: 'UNPAID' | 'PARTIAL' | 'PAID' (optional)
  - `search`: string (optional) - searches in invoice number, notes, supplier name
- **Response**: Paginated list with metadata

### 3. Get Next Invoice Number
- **GET** `/next-invoice-number`
- **Response**: `{ nextInvoiceNumber: "PI-2026-0001" }`

### 4. Get Summary Statistics
- **GET** `/summary?supplierId=optional`
- **Response**: 
```json
{
  "totalInvoices": 150,
  "draftInvoices": 25,
  "approvedInvoices": 120,
  "totalAmount": 500000.00,
  "paidAmount": 400000.00,
  "pendingAmount": 100000.00
}
```

### 5. Get Valued GRNs
- **GET** `/valued-grns`
- **Response**: List of GRNs with VALUED status available for invoicing

### 6. Get Available Landed Costs
- **GET** `/available-landed-costs`
- **Response**: List of approved landed costs available for invoicing

### 7. Get Purchase Invoice by ID
- **GET** `/:id`
- **Response**: Invoice with full details including items, payments, etc.

### 8. Update Purchase Invoice
- **PATCH** `/:id`
- **Body**: UpdatePurchaseInvoiceDto (partial)
- **Features**: 
  - Prevents modification of approved invoices
  - Recalculates totals if items updated
  - Maintains payment integrity

### 9. Approve Invoice
- **PATCH** `/:id/approve`
- **Features**: 
  - Only submitted invoices can be approved
  - Sets approval timestamp
  - Updates status to APPROVED

### 10. Cancel Invoice
- **PATCH** `/:id/cancel`
- **Body**: `{ reason?: "optional cancellation reason" }`
- **Features**: 
  - Prevents cancellation if payments exist
  - Adds cancellation reason to notes
  - Sets cancellation timestamp

### 11. Delete Purchase Invoice
- **DELETE** `/:id`
- **Features**: 
  - Prevents deletion of approved invoices
  - Prevents deletion if payments exist

## Key Business Rules:
- ✅ GRN must be VALUED before invoicing
- ✅ Landed Cost must be APPROVED before invoicing
- ✅ Invoice quantities cannot exceed available quantities
- ✅ Duplicate invoice numbers prevented
- ✅ Approved invoices cannot be modified/deleted
- ✅ Invoices with payments cannot be cancelled/deleted
- ✅ Automatic total calculations with tax and discount support
- ✅ Payment tracking integration
- ✅ Comprehensive audit trail