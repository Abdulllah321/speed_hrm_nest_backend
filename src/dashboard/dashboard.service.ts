import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) { }

  async getDashboardStats() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 1. Employee Stats
    const totalEmployees = await this.prisma.employee.count({
      where: { status: 'active' },
    });

    const inactiveEmployees = await this.prisma.employee.count({
      where: { status: 'inactive' },
    });

    // 2. Attendance Stats (Today)
    const presentToday = await this.prisma.attendance.count({
      where: {
        date: {
          gte: today,
          lt: tomorrow,
        },
        status: 'present',
      },
    });

    const absentToday = await this.prisma.attendance.count({
      where: {
        date: {
          gte: today,
          lt: tomorrow,
        },
        status: 'absent',
      },
    });

    // 3. Pending Requests
    const pendingLeaves = await this.prisma.leaveApplication.count({
      where: { status: 'pending' },
    });

    const pendingAttendanceQueries =
      await this.prisma.attendanceRequestQuery.count({
        where: { approvalStatus: 'pending' },
      });

    // 4. Department Distribution
    const employeesByDepartment = await this.prisma.employee.groupBy({
      by: ['departmentId'],
      _count: {
        id: true,
      },
      where: { status: 'active' },
    });

    // Enrich department names (this might need a separate query or include if possible, but groupBy doesn't support include)
    // We'll fetch all departments to map names
    const departments = await this.prisma.department.findMany({
      select: { id: true, name: true },
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
        totalEmployees,
        inactiveEmployees,
        presentToday,
        absentToday,
        pendingLeaves,
        pendingAttendanceQueries,
      },
      departmentStats,
    };
  }

  async getEmployeeDashboardStats(userId: string) {
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
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
        });

        if (user && user.email) {
          console.log(`[Dashboard] Checking for employee with email: ${user.email}`);
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
            console.log(`[Dashboard] No employee matched with email: ${user.email}`);

            // Fallback: Try matching by Phone Number
            if (user.phone) {
              console.log(`[Dashboard] Email match failed. Checking by Phone: ${user.phone}`);
              const matchedByPhone = await this.prisma.employee.findFirst({
                where: {
                  contactNumber: user.phone,
                },
              });

              if (matchedByPhone) {
                if (!matchedByPhone.userId || matchedByPhone.userId === userId) {
                  console.log(
                    `[Dashboard] Found matching employee by Phone: ${matchedByPhone.employeeName}. Linking now...`,
                  );
                  employee = await this.prisma.employee.update({
                    where: { id: matchedByPhone.id },
                    data: { userId: user.id },
                  });
                } else {
                  console.warn(`[Dashboard] Employee matched by phone (${matchedByPhone.employeeName}) is already linked to another user.`);
                }
              } else {
                console.log(`[Dashboard] No employee matched with phone: ${user.phone}`);
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
    };
  }
}
