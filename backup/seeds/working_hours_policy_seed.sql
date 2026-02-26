--
-- Working Hours Policy Seed Data
-- Run this against your tenant database to seed working hours policies
--
-- IMPORTANT: The first policy (Regular Working Hours) uses ID '949eb252-430a-4517-b704-47f2b43a779d'
-- which is already referenced by all employees in the Employee table.
--

ALTER TABLE public."WorkingHoursPolicy" DISABLE TRIGGER ALL;

-- ============================================================================
-- 1. Regular Working Hours (DEFAULT — referenced by all employees)
-- ============================================================================
-- Schedule: Mon-Fri 09:00-18:00 (full day), Saturday 09:00-14:00 (half day), Sunday off
-- Break: 13:00-14:00
-- Late tolerance: 15 minutes (09:15), deduction after 3 lates = 50% of daily
-- Half-day: starts at 13:00, deduction after 2 half-days = PKR 500
-- Short day: less than 270 mins (4.5 hours), deduction after 3 short days = PKR 300
-- Overtime: x1.5 regular, x2 gazzetted holidays

INSERT INTO public."WorkingHoursPolicy" (
  id, name, "startWorkingHours", "endWorkingHours", "shortDayMins",
  "startBreakTime", "endBreakTime", "halfDayStartTime", "lateStartTime",
  "lateDeductionType", "applyDeductionAfterLates", "lateDeductionPercent",
  "halfDayDeductionType", "applyDeductionAfterHalfDays", "halfDayDeductionAmount",
  "shortDayDeductionType", "applyDeductionAfterShortDays", "shortDayDeductionAmount",
  "overtimeRate", "gazzetedOvertimeRate", "dayOverrides",
  status, "isDefault", "createdById", "createdAt", "updatedAt"
) VALUES (
  '949eb252-430a-4517-b704-47f2b43a779d',
  'Regular Working Hours',
  '09:00',
  '18:00',
  270,
  '13:00',
  '14:00',
  '13:00',
  '09:15',
  'percentage',
  3,
  50.00,
  'fixed',
  2,
  500.00,
  'fixed',
  3,
  300.00,
  1.5,
  2.0,
  '[{"days":["monday","tuesday","wednesday","thursday"],"enabled":true,"overrideHours":false,"startTime":"","endTime":"","overrideBreak":false,"startBreakTime":"","endBreakTime":"","dayType":"full"},{"days":["friday"],"enabled":true,"overrideHours":false,"startTime":"","endTime":"","overrideBreak":false,"startBreakTime":"","endBreakTime":"","dayType":"full"},{"days":["saturday"],"enabled":true,"overrideHours":true,"startTime":"09:00","endTime":"14:00","overrideBreak":false,"startBreakTime":"","endBreakTime":"","dayType":"half"},{"days":["sunday"],"enabled":false,"overrideHours":false,"startTime":"","endTime":"","overrideBreak":false,"startBreakTime":"","endBreakTime":"","dayType":"full"}]',
  'active',
  true,
  NULL,
  '2026-01-12 11:26:32.000',
  '2026-01-12 11:26:32.000'
);


-- ============================================================================
-- 2. Warehouse Shift Policy
-- ============================================================================
-- Schedule: Mon-Sat 08:00-17:00 (full day), Sunday off
-- Break: 12:00-12:30 (30 min lunch)
-- Late tolerance: 10 minutes (08:10), deduction after 2 lates = 25% of daily
-- Half-day: starts at 12:30, deduction after 3 half-days = PKR 400
-- Short day: less than 240 mins (4 hours), deduction after 2 short days = PKR 200
-- Overtime: x1 regular, x1.5 gazzetted holidays

INSERT INTO public."WorkingHoursPolicy" (
  id, name, "startWorkingHours", "endWorkingHours", "shortDayMins",
  "startBreakTime", "endBreakTime", "halfDayStartTime", "lateStartTime",
  "lateDeductionType", "applyDeductionAfterLates", "lateDeductionPercent",
  "halfDayDeductionType", "applyDeductionAfterHalfDays", "halfDayDeductionAmount",
  "shortDayDeductionType", "applyDeductionAfterShortDays", "shortDayDeductionAmount",
  "overtimeRate", "gazzetedOvertimeRate", "dayOverrides",
  status, "isDefault", "createdById", "createdAt", "updatedAt"
) VALUES (
  'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  'Warehouse Shift Policy',
  '08:00',
  '17:00',
  240,
  '12:00',
  '12:30',
  '12:30',
  '08:10',
  'percentage',
  2,
  25.00,
  'fixed',
  3,
  400.00,
  'fixed',
  2,
  200.00,
  1.0,
  1.5,
  '[{"days":["monday","tuesday","wednesday","thursday","friday","saturday"],"enabled":true,"overrideHours":false,"startTime":"","endTime":"","overrideBreak":false,"startBreakTime":"","endBreakTime":"","dayType":"full"},{"days":["sunday"],"enabled":false,"overrideHours":false,"startTime":"","endTime":"","overrideBreak":false,"startBreakTime":"","endBreakTime":"","dayType":"full"}]',
  'active',
  false,
  NULL,
  '2026-01-12 11:26:32.000',
  '2026-01-12 11:26:32.000'
);


-- ============================================================================
-- 3. Executive Flexible Hours
-- ============================================================================
-- Schedule: Mon-Fri 10:00-19:00, Saturday & Sunday off
-- Break: 13:30-14:30
-- Late tolerance: 30 minutes (10:30), deduction after 5 lates = 25% of daily
-- No half-day or short-day deductions (executive privilege)
-- Overtime: x2 regular, x2.5 gazzetted holidays

INSERT INTO public."WorkingHoursPolicy" (
  id, name, "startWorkingHours", "endWorkingHours", "shortDayMins",
  "startBreakTime", "endBreakTime", "halfDayStartTime", "lateStartTime",
  "lateDeductionType", "applyDeductionAfterLates", "lateDeductionPercent",
  "halfDayDeductionType", "applyDeductionAfterHalfDays", "halfDayDeductionAmount",
  "shortDayDeductionType", "applyDeductionAfterShortDays", "shortDayDeductionAmount",
  "overtimeRate", "gazzetedOvertimeRate", "dayOverrides",
  status, "isDefault", "createdById", "createdAt", "updatedAt"
) VALUES (
  'b2c3d4e5-f6a7-8901-bcde-f12345678901',
  'Executive Flexible Hours',
  '10:00',
  '19:00',
  300,
  '13:30',
  '14:30',
  '14:00',
  '10:30',
  'percentage',
  5,
  25.00,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL,
  2.0,
  2.5,
  '[{"days":["monday","tuesday","wednesday","thursday","friday"],"enabled":true,"overrideHours":false,"startTime":"","endTime":"","overrideBreak":false,"startBreakTime":"","endBreakTime":"","dayType":"full"},{"days":["saturday","sunday"],"enabled":false,"overrideHours":false,"startTime":"","endTime":"","overrideBreak":false,"startBreakTime":"","endBreakTime":"","dayType":"full"}]',
  'active',
  false,
  NULL,
  '2026-01-12 11:26:32.000',
  '2026-01-12 11:26:32.000'
);

ALTER TABLE public."WorkingHoursPolicy" ENABLE TRIGGER ALL;
