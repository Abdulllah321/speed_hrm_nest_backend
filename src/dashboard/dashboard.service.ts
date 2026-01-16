import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

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
}
