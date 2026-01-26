# Employee Transfer Module Documentation

This module handles the transfer of employees between different locations, cities, or provinces. It maintains a history of all transfers and automatically updates the employee's current posting details.

## Database Schema

### `EmployeeTransferHistory`
| Field | Type | Description |
|---|---|---|
| `id` | String (UUID) | Unique identifier |
| `employeeId` | String (UUID) | Foreign key to Employee |
| `transferDate` | DateTime | Date of transfer |
| `previousLocationId` | String (UUID) | Location before transfer |
| `previousCityId` | String (UUID) | City before transfer |
| `previousStateId` | String (UUID) | State before transfer |
| `newLocationId` | String (UUID) | New Location ID |
| `newCityId` | String (UUID) | New City ID |
| `newStateId` | String (UUID) | New State ID |
| `reason` | String | Optional reason for transfer |
| `createdById` | String (UUID) | User who performed the transfer |
| `createdAt` | DateTime | Timestamp of creation |

### Relations
- **Employee**: One-to-Many with `EmployeeTransferHistory`.
- **Location/City/State**: Links to Previous and New entities.
- **User**: Linked via `createdById`.

---

## API Endpoints

### 1. Create Transfer
**Endpoint**: `POST /api/employee-transfer`
**Auth**: Bearer Token required
**Payload**:
```json
{
  "employeeId": "uuid-of-employee",
  "transferDate": "2024-03-20T00:00:00.000Z",
  "newLocationId": "uuid-of-new-location",
  "newCityId": "uuid-of-new-city",   // Optional: Auto-inferred if location has city
  "newStateId": "uuid-of-new-state", // Optional: Auto-inferred if city has state
  "reason": "Administrative requirement"
}
```
**Behavior**:
- Verifies existence of Employee and New Location.
- Logs the *current* location/city/state of the employee as `previous...` in history.
- Updates the **Employee** record with `locationId`, `cityId`, and `stateId`.
- Creates a new record in `EmployeeTransferHistory`.
- Logs the action in `ActivityLogs`.

### 2. Get Transfer History
**Endpoint**: `GET /api/employee-transfer/employee/:id`
**Auth**: Bearer Token required
**Response**:
List of transfer records for the specified employee, including relations to Location, City, State, and Creator.

---

## Backend Implementation Details

- **Module**: `TransferModule`
- **Controller**: `TransferController` (`src/employee/transfer/transfer.controller.ts`)
- **Service**: `TransferService` (`src/employee/transfer/transfer.service.ts`)
- **DTO**: `CreateTransferDto`

### Key Logic (`TransferService.create`)
1.  **Fetch Employee**: Gets current details (`locationId`, `cityId`, etc.).
2.  **Validation**: Checks if new location exists.
3.  **Transaction**:
    -   Creates `EmployeeTransferHistory` entry using current employee data as 'previous' and input data as 'new'.
    -   Updates `Employee` table with the new location/city/state.
    -   Logs to `ActivityLogs`.

## Frontend Integration

- **Form**: `TransferForm` (`components/employee/transfer-form.tsx`)
    - Uses `Autocomplete` for searching Locations/Cities.
    - Auto-fills City/State based on Location selection.
- **Actions**: `createTransfer` and `getTransferHistory` in `lib/actions/transfer.ts`.
- **UI**: 
    - "Transfer Employee" button on Employee View page.
    - "Transfer History" timeline on Employee View page.
