import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { TaskReportsService } from '../task-reports/task-reports.service';

@Injectable()
export class DashboardService {
  constructor(
    private prisma: PrismaService,
    private prismaMaster: PrismaMasterService,
    private taskReports: TaskReportsService,
  ) { }

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

    const weekBeforeStart = new Date(lastWeekStart);
    weekBeforeStart.setDate(weekBeforeStart.getDate() - 7);

    const fourteenDaysAgo = new Date(today);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13);

    // Consolidated Data Fetching
    const [
      activeEmployees,
      inactiveEmployeesCount,
      totalEmployeesLastWeekCount,
      attendanceTodayStats,
      attendanceLastWeekStats,
      pendingLeavesStatus,
      pendingLeavesLastWeekCount,
      pendingAttendanceQueriesStatus,
      pendingQueriesLastWeekCount,
      departments,
      last7DaysPresence,
      weekBeforePresence,
      lateArrivals,
      attendancesForTrend,
      recentLeaveRequests,
      employeesByDepartment,
    ] = await Promise.all([
      this.prisma.employee.findMany({
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
      }),
      this.prisma.employee.count({ where: { status: 'inactive' } }),
      this.prisma.employee.count({
        where: { status: 'active', createdAt: { lt: lastWeekStart } },
      }),
      this.prisma.attendance.groupBy({
        by: ['status'],
        where: { date: { gte: today, lt: tomorrow } },
        _count: { id: true },
      }),
      this.prisma.attendance.groupBy({
        by: ['status'],
        where: { date: { gte: lastWeekStart, lt: lastWeekEnd } },
        _count: { id: true },
      }),
      this.prisma.leaveApplication.count({ where: { status: 'pending' } }),
      this.prisma.leaveApplication.count({
        where: { status: 'pending', createdAt: { lt: lastWeekStart } },
      }),
      this.prisma.attendanceRequestQuery.count({
        where: { approvalStatus: 'pending' },
      }),
      this.prisma.attendanceRequestQuery.count({
        where: { approvalStatus: 'pending', createdAt: { lt: lastWeekStart } },
      }),
      this.prisma.department.findMany({ select: { id: true, name: true } }),
      this.prisma.attendance.count({
        where: { date: { gte: lastWeekStart, lt: today }, status: 'present' },
      }),
      this.prisma.attendance.count({
        where: { date: { gte: weekBeforeStart, lt: lastWeekStart }, status: 'present' },
      }),
      this.prisma.attendance.findMany({
        where: { date: { gte: lastWeekStart }, lateMinutes: { gt: 0 } },
        select: { employeeId: true, lateMinutes: true },
      }),
      this.prisma.attendance.findMany({
        where: {
          date: { gte: fourteenDaysAgo, lt: tomorrow },
          status: { in: ['present', 'absent'] },
        },
        select: { date: true, status: true },
      }),
      this.prisma.leaveApplication.findMany({
        orderBy: { createdAt: 'desc' },
        take: 8,
        include: {
          employee: { select: { employeeName: true, departmentId: true } },
        },
      }),
      this.prisma.employee.groupBy({
        by: ['departmentId'],
        _count: { id: true },
        where: { status: 'active' },
      }),
    ]);

    // 1. Basic Stats Processing
    const totalEmployees = activeEmployees.length;
    const employeeTrend = totalEmployeesLastWeekCount === 0 ? 0 : Math.round(((totalEmployees - totalEmployeesLastWeekCount) / totalEmployeesLastWeekCount) * 100);

    const presentToday = attendanceTodayStats.find(s => s.status === 'present')?._count.id || 0;
    const absentToday = attendanceTodayStats.find(s => s.status === 'absent')?._count.id || 0;
    const presentLastWeek = attendanceLastWeekStats.find(s => s.status === 'present')?._count.id || 0;
    const presentTrend = presentLastWeek === 0 ? 0 : Math.round(((presentToday - presentLastWeek) / presentLastWeek) * 100);

    const leavesTrend = pendingLeavesLastWeekCount === 0 ? 0 : Math.round(((pendingLeavesStatus - pendingLeavesLastWeekCount) / pendingLeavesLastWeekCount) * 100);
    const queriesTrend = pendingQueriesLastWeekCount === 0 ? 0 : Math.round(((pendingAttendanceQueriesStatus - pendingQueriesLastWeekCount) / pendingQueriesLastWeekCount) * 100);

    // 2. Celebrations & Critical Alerts
    const getEffectiveDate = (d: Date) => {
      const bday = new Date(d);
      const thisYear = new Date(today.getFullYear(), bday.getMonth(), bday.getDate());
      if (thisYear >= today) return thisYear;
      return new Date(today.getFullYear() + 1, bday.getMonth(), bday.getDate());
    };

    const upcomingBirthdays = activeEmployees
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

    const upcomingAnniversaries = activeEmployees
      .filter((emp) => {
        if (!emp.joiningDate) return false;
        const joinDate = new Date(emp.joiningDate as Date);
        const thisYearAnn = new Date(today.getFullYear(), joinDate.getMonth(), joinDate.getDate());
        const nextYearAnn = new Date(today.getFullYear() + 1, joinDate.getMonth(), joinDate.getDate());
        return joinDate.getFullYear() < today.getFullYear() && ((thisYearAnn >= today && thisYearAnn <= next30Days) || (nextYearAnn >= today && nextYearAnn <= next30Days));
      })
      .map((emp) => ({
        name: emp.employeeName,
        date: emp.joiningDate,
        years: today.getFullYear() - new Date(emp.joiningDate as Date).getFullYear(),
        department: departments.find((d) => d.id === emp.departmentId)?.name || 'N/A',
      }))
      .sort((a, b) => getEffectiveDate(a.date as Date).getTime() - getEffectiveDate(b.date as Date).getTime());

    const criticalAlerts: any[] = [];
    activeEmployees.forEach((emp) => {
      if (emp.cnicExpiryDate && new Date(emp.cnicExpiryDate as Date) <= next30Days) {
        criticalAlerts.push({
          type: 'CNIC_EXPIRY', priority: 'high',
          message: `CNIC for ${emp.employeeName} expires on ${new Date(emp.cnicExpiryDate as Date).toLocaleDateString()}`,
          employeeId: emp.id,
        });
      }
      if (emp.probationExpiryDate && new Date(emp.probationExpiryDate as Date) <= next30Days) {
        criticalAlerts.push({
          type: 'PROBATION_EXPIRY', priority: 'medium',
          message: `${emp.employeeName} completes probation on ${new Date(emp.probationExpiryDate as Date).toLocaleDateString()}`,
          employeeId: emp.id,
        });
      }
    });

    // 4. Heavy Analytics Suggestions
    const analyticsSuggestions: any[] = [];
    if (last7DaysPresence < weekBeforePresence * 0.9) {
      analyticsSuggestions.push({
        title: 'Attendance Decline',
        description: `Average presence decreased by ${Math.round((1 - last7DaysPresence / (weekBeforePresence || 1)) * 100)}% compared to last week.`,
        impact: 'high',
      });
    }
    if (pendingLeavesStatus > totalEmployees * 0.1) {
      analyticsSuggestions.push({
        title: 'Leave Approval Bottleneck',
        description: `Over 10% of your workforce has pending leave requests. Consider reviewing approvals to avoid operational gaps.`,
        impact: 'medium',
      });
    }
    if (lateArrivals.length > totalEmployees * 0.2) {
      analyticsSuggestions.push({
        title: 'Late Arrival Pattern',
        description: `Unusual spike in late arrivals detected this week (affected ${Math.round((lateArrivals.length / totalEmployees) * 100)}% of staff).`,
        impact: 'medium',
      });
    }

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

    // 6. Attendance Trend Processing
    const attendanceTrend: any[] = [];
    for (let i = 13; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dayRecords = attendancesForTrend.filter(a => {
        const d = new Date(a.date);
        return d.getDate() === date.getDate() && d.getMonth() === date.getMonth() && d.getFullYear() === date.getFullYear();
      });

      attendanceTrend.push({
        date: date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' }),
        present: dayRecords.filter(a => a.status === 'present').length,
        absent: dayRecords.filter(a => a.status === 'absent').length,
      });
    }

    // 7. Recent Leave Requests Formatting
    const formattedRecentLeaves = recentLeaveRequests.map((l) => ({
      id: l.id,
      employeeName: (l as any).employee?.employeeName || 'Unknown',
      department: departments.find((d) => d.id === (l as any).employee?.departmentId)?.name || 'N/A',
      type: 'Leave', status: l.status,
      dateFrom: (l as any).fromDate, dateTo: (l as any).toDate,
      days: Math.ceil((new Date((l as any).toDate).getTime() - new Date((l as any).fromDate).getTime()) / (1000 * 60 * 60 * 24)) + 1,
    }));

    // 8. Department Stats Processing
    const departmentStats = employeesByDepartment.map((ed) => {
      const dept = departments.find((d) => d.id === ed.departmentId);
      return { name: dept?.name || 'Unknown', count: ed._count.id };
    });

    return {
      overview: {
        totalEmployees: { value: totalEmployees, trend: employeeTrend, trendType: employeeTrend >= 0 ? 'up' : 'down' },
        inactiveEmployees: { value: inactiveEmployeesCount },
        presentToday: { value: presentToday, trend: presentTrend, trendType: presentTrend >= 0 ? 'up' : 'down' },
        absentToday: { value: absentToday },
        pendingLeaves: { value: pendingLeavesStatus, trend: leavesTrend, trendType: leavesTrend >= 0 ? 'up' : 'down' },
        pendingAttendanceQueries: { value: pendingAttendanceQueriesStatus, trend: queriesTrend, trendType: queriesTrend >= 0 ? 'up' : 'down' },
      },
      departmentStats, upcomingBirthdays, upcomingAnniversaries, criticalAlerts, analyticsSuggestions, attendanceTrend, recentLeaveRequests: formattedRecentLeaves,
      taskWidgets: await this.taskReports.adminWidgets().catch(() => null),
    };
  }
  async getEmployeeDashboardStats(userId: string) {
    this.prisma.ensureTenantContext();

    let employee = await this.prisma.employee.findUnique({
      where: { userId },
    });

    // Auto-link logic: If not linked, try to match by email
    if (!employee) {
   

      try {
        const user = await this.prismaMaster.user.findUnique({
          where: { id: userId },
        });

        if (user && user.email) {
          
          const matchedEmployee = await this.prisma.employee.findFirst({
            where: {
              OR: [
                { officialEmail: { equals: user.email, mode: 'insensitive' } },
                { personalEmail: { equals: user.email, mode: 'insensitive' } },
              ],
            },
          });

          if (matchedEmployee) {
          

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
          
            }
          } else {
            // Fallback: Try matching by Phone Number
            if (user.phone) {
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
                  employee = await this.prisma.employee.update({
                    where: { id: matchedByPhone.id },
                    data: { userId: user.id },
                  });
                }
              } 
            }
          }
        }
      } catch (err) {
        console.error('[Dashboard] Error during auto-linking:', err);
      }
    }

    if (!employee) {

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

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

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
    const upcomingHoliday = await this.prisma.holiday.findFirst({
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
      taskWidgets: await this.taskReports.employeeWidgets(employee.id).catch(() => null),
    };
  }
}
