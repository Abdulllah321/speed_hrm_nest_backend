import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
  ) {}

  async getDashboardStats() {
    this.prisma.ensureTenantContext();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const next30Days = new Date(today);
    next30Days.setDate(next30Days.getDate() + 30);

    const lastWeekStart = new Date(today);
    lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const lastWeekEnd = new Date(lastWeekStart);
    lastWeekEnd.setDate(lastWeekEnd.getDate() + 1);

    // 1. Basic Stats & Trends
    const totalEmployees = await this.prisma.employee.count({
      where: { status: 'active' },
    });
    const totalEmployeesLastWeek = await this.prisma.employee.count({
      where: {
        status: 'active',
        createdAt: { lt: lastWeekStart }
      },
    });
    const employeeTrend = totalEmployeesLastWeek === 0 ? 0 : Math.round(((totalEmployees - totalEmployeesLastWeek) / totalEmployeesLastWeek) * 100);

    const inactiveEmployees = await this.prisma.employee.count({
      where: { status: 'inactive' },
    });

    const presentToday = await this.prisma.attendance.count({
      where: {
        date: { gte: today, lt: tomorrow },
        status: 'present',
      },
    });
    const presentLastWeek = await this.prisma.attendance.count({
      where: {
        date: { gte: lastWeekStart, lt: lastWeekEnd },
        status: 'present',
      },
    });
    const presentTrend = presentLastWeek === 0 ? 0 : Math.round(((presentToday - presentLastWeek) / presentLastWeek) * 100);

    const absentToday = await this.prisma.attendance.count({
      where: {
        date: { gte: today, lt: tomorrow },
        status: 'absent',
      },
    });

    const pendingLeaves = await this.prisma.leaveApplication.count({
      where: { status: 'pending' },
    });
    const pendingLeavesLastWeek = await this.prisma.leaveApplication.count({
      where: {
        status: 'pending',
        createdAt: { lt: lastWeekStart }
      },
    });
    // For pending items, a "down" trend is often "good", but we'll just show the raw % change
    const leavesTrend = pendingLeavesLastWeek === 0 ? 0 : Math.round(((pendingLeaves - pendingLeavesLastWeek) / pendingLeavesLastWeek) * 100);

    const pendingAttendanceQueries = await this.prisma.attendanceRequestQuery.count({
      where: { approvalStatus: 'pending' },
    });
    const pendingQueriesLastWeek = await this.prisma.attendanceRequestQuery.count({
      where: {
        approvalStatus: 'pending',
        createdAt: { lt: lastWeekStart }
      },
    });
    const queriesTrend = pendingQueriesLastWeek === 0 ? 0 : Math.round(((pendingAttendanceQueries - pendingQueriesLastWeek) / pendingQueriesLastWeek) * 100);

    // 2. Celebrations (Birthdays & Anniversaries)
    const employees = await this.prisma.employee.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        employeeName: true,
        dateOfBirth: true,
        joiningDate: true,
        departmentId: true,
        designationId: true,
        officialEmail: true,
        cnicExpiryDate: true,
        probationExpiryDate: true,
      },
    });

    const departments = await this.prismaMaster.department.findMany({
      select: { id: true, name: true },
    });

    const getEffectiveDate = (d: Date) => {
      const bday = new Date(d);
      const thisYear = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());
      if (thisYear >= today) return thisYear;
      return new Date(today.getFullYear() + 1, bday.getMonth(), bday.getDate());
    };

    const upcomingBirthdays = employees
      .filter((emp) => {
        if (!emp.dateOfBirth) return false;
        const bday = new Date(emp.dateOfBirth as Date);
        const thisYearBday = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());
        const nextYearBday = new Date(today.getFullYear() + 1, bday.getMonth(), bday.getDate());
        return (thisYearBday >= today && thisYearBday <= next30Days) || (nextYearBday >= today && nextYearBday <= next30Days);
      })
      .map((emp) => ({
        name: emp.employeeName,
        date: emp.dateOfBirth,
        department: departments.find((d) => d.id === emp.departmentId)?.name || 'N/A',
      }))
      .sort((a, b) => getEffectiveDate(a.date as Date).getTime() - getEffectiveDate(b.date as Date).getTime());

    const upcomingAnniversaries = employees
      .filter((emp) => {
        if (!emp.joiningDate) return false;
        const joinDate = new Date(emp.joiningDate as Date);
        const thisYearAnn = new Date(today.getFullYear(), joinDate.getMonth(), joinDate.getDate());
        const nextYearAnn = new Date(today.getFullYear() + 1, joinDate.getMonth(), joinDate.getDate());
        const isThisYear = thisYearAnn >= today && thisYearAnn <= next30Days;
        const isNextYear = nextYearAnn >= today && nextYearAnn <= next30Days;
        return (isThisYear || isNextYear) && joinDate.getFullYear() < today.getFullYear();
      })
      .map((emp) => {
        const joinDate = new Date(emp.joiningDate as Date);
        const years = today.getFullYear() - joinDate.getFullYear();
        return {
          name: emp.employeeName,
          date: emp.joiningDate,
          years,
          department: departments.find((d) => d.id === emp.departmentId)?.name || 'N/A',
        };
      })
      .sort((a, b) => getEffectiveDate(a.date as Date).getTime() - getEffectiveDate(b.date as Date).getTime());

    // 3. Critical Alerts
    const criticalAlerts: any[] = [];
    employees.forEach((emp) => {
      if (emp.cnicExpiryDate && new Date(emp.cnicExpiryDate as Date) <= next30Days) {
        criticalAlerts.push({
          type: 'CNIC_EXPIRY',
          priority: 'high',
          message: `CNIC for ${emp.employeeName} expires on ${new Date(emp.cnicExpiryDate as Date).toLocaleDateString()}`,
          employeeId: emp.id,
        });
      }
      if (emp.probationExpiryDate && new Date(emp.probationExpiryDate as Date) <= next30Days) {
        criticalAlerts.push({
          type: 'PROBATION_EXPIRY',
          priority: 'medium',
          message: `${emp.employeeName} completes probation on ${new Date(emp.probationExpiryDate as Date).toLocaleDateString()}`,
          employeeId: emp.id,
        });
      }
    });

    // 4. Heavy Analytics Suggestions
    const analyticsSuggestions: any[] = [];

    // Trend: Attendance
    const last7DaysPresence = await this.prisma.attendance.count({
      where: { date: { gte: lastWeekStart, lt: today }, status: 'present' },
    });
    const weekBeforeStart = new Date(lastWeekStart);
    weekBeforeStart.setDate(weekBeforeStart.getDate() - 7);
    const weekBeforePresence = await this.prisma.attendance.count({
      where: { date: { gte: weekBeforeStart, lt: lastWeekStart }, status: 'present' },
    });

    if (last7DaysPresence < weekBeforePresence * 0.9) {
      analyticsSuggestions.push({
        title: 'Attendance Decline',
        description: `Average presence decreased by ${Math.round((1 - last7DaysPresence / (weekBeforePresence || 1)) * 100)}% compared to last week.`,
        impact: 'high',
      });
    }

    // Bottlenecks: Departments with many pending requests
    // (Simplified: using the overall pendingLeaves compare)
    if (pendingLeaves > totalEmployees * 0.1) {
      analyticsSuggestions.push({
        title: 'Leave Approval Bottleneck',
        description: `Over 10% of your workforce has pending leave requests. Consider reviewing approvals to avoid operational gaps.`,
        impact: 'medium',
      });
    }

    // Late Arrivals Hotspot
    const lateArrivals = await this.prisma.attendance.findMany({
      where: { date: { gte: lastWeekStart }, lateMinutes: { gt: 0 } },
      select: { employeeId: true, lateMinutes: true },
    });
    if (lateArrivals.length > totalEmployees * 0.2) {
      analyticsSuggestions.push({
        title: 'Late Arrival Pattern',
        description: `Unusual spike in late arrivals detected this week (affected ${Math.round((lateArrivals.length / totalEmployees) * 100)}% of staff).`,
        impact: 'medium',
      });
    }

    // Retention Risk (Dummy logic based on high late frequency)
    const lateFrequencies = lateArrivals.reduce((acc, curr) => {
      acc[curr.employeeId] = (acc[curr.employeeId] || 0) + 1;
      return acc;
    }, {});
    const highLateFreqCount = Object.values(lateFrequencies).filter(v => (v as number) >= 3).length;
    if (highLateFreqCount > 0) {
      analyticsSuggestions.push({
        title: 'Retention Risk Indicator',
        description: `${highLateFreqCount} employees have arrived late 3+ times this week. High late frequency can sometimes indicate disengagement.`,
        impact: 'low',
      });
    }


    // 6. Attendance Trend (Last 14 days)
    const attendanceTrend: any[] = [];
    for (let i = 13; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);

      const presentCount = await this.prisma.attendance.count({
        where: { date: { gte: date, lt: nextDate }, status: 'present' },
      });
      const absentCount = await this.prisma.attendance.count({
        where: { date: { gte: date, lt: nextDate }, status: 'absent' },
      });

      attendanceTrend.push({
        date: date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
        present: presentCount,
        absent: absentCount,
      });
    }

    // 7. Recent Leave Requests
    const recentLeaveRequests = await this.prisma.leaveApplication.findMany({
      orderBy: { createdAt: 'desc' },
      take: 8,
      include: {
        employee: { select: { employeeName: true, departmentId: true } },
      },
    });

    const formattedRecentLeaves = recentLeaveRequests.map((l) => ({
      id: l.id,
      employeeName: (l as any).employee?.employeeName || 'Unknown',
      department: departments.find((d) => d.id === (l as any).employee?.departmentId)?.name || 'N/A',
      type: 'Leave', // Simplified since leaveType relation is not found in schema
      status: l.status,
      dateFrom: (l as any).fromDate,
      dateTo: (l as any).toDate,
      days: Math.ceil((new Date((l as any).toDate).getTime() - new Date((l as any).fromDate).getTime()) / (1000 * 60 * 60 * 24)) + 1,
    }));

    // 8. Department Stats
    const employeesByDepartment = await this.prisma.employee.groupBy({
      by: ['departmentId'],
      _count: { id: true },
      where: { status: 'active' },
    });

    const departmentStats = employeesByDepartment.map((ed) => {
      const dept = departments.find((d) => d.id === ed.departmentId);
      return {
        name: dept?.name || 'Unknown',
        count: ed._count.id,
      };
    });

    return {
      overview: {
        totalEmployees: { value: totalEmployees, trend: employeeTrend, trendType: employeeTrend >= 0 ? 'up' : 'down' },
        inactiveEmployees: { value: inactiveEmployees },
        presentToday: { value: presentToday, trend: presentTrend, trendType: presentTrend >= 0 ? 'up' : 'down' },
        absentToday: { value: absentToday },
        pendingLeaves: { value: pendingLeaves, trend: leavesTrend, trendType: leavesTrend >= 0 ? 'up' : 'down' },
        pendingAttendanceQueries: { value: pendingAttendanceQueries, trend: queriesTrend, trendType: queriesTrend >= 0 ? 'up' : 'down' },
      },
      departmentStats,
      upcomingBirthdays,
      upcomingAnniversaries,
      criticalAlerts,
      analyticsSuggestions,
      attendanceTrend,
      recentLeaveRequests: formattedRecentLeaves,
    };
  }

  async getEmployeeDashboardStats(userId: string) {
    this.prisma.ensureTenantContext();
    console.log(`[Dashboard] Fetching stats for userId: ${userId}`);

    let employee = await this.prisma.employee.findUnique({
      where: { userId },
    });

    // Auto-link logic: If not linked, try to match by email
    if (!employee) {
      console.log(
        `[Dashboard] Employee not found via userId. Attempting email match...`,
      );

      try {
        const user = await this.prismaMaster.user.findUnique({
          where: { id: userId },
        });

        if (user && user.email) {
          console.log(
            `[Dashboard] Checking for employee with email: ${user.email}`,
          );
          const matchedEmployee = await this.prisma.employee.findFirst({
            where: {
              OR: [
                { officialEmail: { equals: user.email, mode: 'insensitive' } },
                { personalEmail: { equals: user.email, mode: 'insensitive' } },
              ],
            },
          });

          if (matchedEmployee) {
            console.log(
              `[Dashboard] Found matching employee by email: ${matchedEmployee.employeeName}. Linking now...`,
            );

            // Verify if this employee is already linked to another user (edge case)
            if (matchedEmployee.userId && matchedEmployee.userId !== userId) {
              console.warn(
                `[Dashboard] Employee ${matchedEmployee.employeeName} is already linked to another user ID: ${matchedEmployee.userId}. Cannot auto-link.`,
              );
            } else {
              // Update the employee record with the user ID
              employee = await this.prisma.employee.update({
                where: { id: matchedEmployee.id },
                data: { userId: user.id },
              });
              console.log(
                `[Dashboard] Successfully auto-linked User ${user.email} to Employee ${employee.employeeName}`,
              );
            }
          } else {
            console.log(
              `[Dashboard] No employee matched with email: ${user.email}`,
            );

            // Fallback: Try matching by Phone Number
            if (user.phone) {
              console.log(
                `[Dashboard] Email match failed. Checking by Phone: ${user.phone}`,
              );
              const matchedByPhone = await this.prisma.employee.findFirst({
                where: {
                  contactNumber: user.phone,
                },
              });

              if (matchedByPhone) {
                if (
                  !matchedByPhone.userId ||
                  matchedByPhone.userId === userId
                ) {
                  console.log(
                    `[Dashboard] Found matching employee by Phone: ${matchedByPhone.employeeName}. Linking now...`,
                  );
                  employee = await this.prisma.employee.update({
                    where: { id: matchedByPhone.id },
                    data: { userId: user.id },
                  });
                } else {
                  console.warn(
                    `[Dashboard] Employee matched by phone (${matchedByPhone.employeeName}) is already linked to another user.`,
                  );
                }
              } else {
                console.log(
                  `[Dashboard] No employee matched with phone: ${user.phone}`,
                );
              }
            } else {
              console.log(`[Dashboard] User has no phone number to match.`);
            }
          }
        }
      } catch (err) {
        console.error('[Dashboard] Error during auto-linking:', err);
      }
    }

    if (!employee) {
      console.log(`[Dashboard] Employee not found for userId: ${userId}`);
      // Try to find if there is ANY employee just to debug
      const anyEmployee = await this.prisma.employee.findFirst();
      console.log(
        `[Dashboard] Sample existing employee: ${JSON.stringify(
          anyEmployee?.id,
        )} (UserId: ${anyEmployee?.userId})`,
      );

      // Use a valid default date (today) if no employee found, avoiding invalid date errors
      const today = new Date();
      return {
        overview: {
          presentMonth: 0,
          absentMonth: 0,
          lateMonth: 0,
          pendingLeaves: 0,
          pendingAttendanceQueries: 0,
        },
        upcomingHoliday: null,
        recentActivities: [],
      };
    }

    console.log(
      `[Dashboard] Found employee: ${employee.id} (${employee.employeeName})`,
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    console.log(
      `[Dashboard] Date Range: ${startOfMonth.toISOString()} to ${endOfMonth.toISOString()}`,
    );

    // 1. My Attendance Stats (Current Month)
    const attendanceStats = await this.prisma.attendance.groupBy({
      by: ['status'],
      where: {
        employeeId: employee.id,
        date: {
          gte: startOfMonth,
          lte: endOfMonth,
        },
      },
      _count: {
        id: true,
      },
    });

    const presentCount =
      attendanceStats.find((s) => s.status === 'present')?._count.id || 0;
    const absentCount =
      attendanceStats.find((s) => s.status === 'absent')?._count.id || 0;
    const lateCount =
      (await this.prisma.attendance.count({
        where: {
          employeeId: employee.id,
          date: {
            gte: startOfMonth,
            lte: endOfMonth,
          },
          lateMinutes: {
            gt: 0,
          },
        },
      })) || 0;

    // 2. Pending Approvals
    const pendingLeaves = await this.prisma.leaveApplication.count({
      where: { employeeId: employee.id, status: 'pending' },
    });

    const pendingAttendanceQueries =
      await this.prisma.attendanceRequestQuery.count({
        where: { employeeId: employee.id, approvalStatus: 'pending' },
      });

    // 3. Upcoming Holidays
    const upcomingHoliday = await this.prismaMaster.holiday.findFirst({
      where: {
        dateFrom: {
          gte: today,
        },
        status: 'active',
      },
      orderBy: {
        dateFrom: 'asc',
      },
    });

    // 4. Last 5 Activities (Attendance logs)
    const recentActivities = await this.prisma.attendance.findMany({
      where: { employeeId: employee.id },
      orderBy: { date: 'desc' },
      take: 5,
      select: {
        date: true,
        checkIn: true,
        checkOut: true,
        status: true,
      },
    });

    return {
      overview: {
        presentMonth: presentCount,
        absentMonth: absentCount,
        lateMonth: lateCount,
        pendingLeaves,
        pendingAttendanceQueries,
      },
      upcomingHoliday,
      recentActivities,
    };
  }
}
