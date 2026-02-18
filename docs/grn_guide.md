# Goods Receipt Note (GRN) & Stock Ledger concept

## What is GRN?
A Goods Receipt Note (GRN) is a document that records the physical arrival of goods at a warehouse. It acts as a bridge between the Purchase Order (the intent to buy) and the Stock Ledger (the actual inventory entry).

## The Stock Ledger concept
Instead of maintaining a static `InventoryStatus` table that is prone to synchronization issues, we use a **Transactional Stock Ledger**.

- **Source of Truth**: Every stock movement (IN, OUT, ADJUSTMENT) is recorded as a single row in the `StockLedger`.
- **Inbound (GRN)**: When a GRN is submitted, a positive entry is added to the ledger for each item.
- **Stock Calculation**: Current stock at any point is the `SUM(qty)` of ledger entries for a specific `item_id` and `warehouse_id`.
- **Integrity**: Since we only append to the ledger, we have a complete audit trail of how stock reached its current level.

## Why No Inventory Table?
By using the Stock Ledger as the primary source of truth:
1. **No Data Lag**: There's no risk of the "stock level" falling out of sync with "stock movements".
2. **Time Travel**: We can calculate the stock level at any historical point in time.
3. **Traceability**: Every unit of stock can be traced back to its specific GRN.

## GRN Workflow
1. **Selection**: User selects an OPEN Purchase Order.
2. **Partial Receiving**: User enters the quantity actually received (can be less than ordered).
3. **Verification**: System ensures `receivedQty` <= `remainingQty` (Ordered - Already Received).
4. **Submission**:
   - `StockLedger` is updated (+ qty).
   - `PurchaseOrderItem.receivedQty` is incremented.
   - `PurchaseOrder.status` is updated (PARTIALLY_RECEIVED or CLOSED).
