import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { PrismaMasterService } from '../database/prisma-master.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserService {
  constructor(
    private prismaMaster: PrismaMasterService,
    private prisma: PrismaService,
  ) {}

  async create(createUserDto: CreateUserDto) {
    const existing = await this.prismaMaster.user.findUnique({
      where: { email: createUserDto.email },
    });

    if (existing) {
      throw new ConflictException('User with this email already exists');
    }

    if (createUserDto.employeeId) {
      const existingEmployeeUser = await this.prismaMaster.user.findUnique({
        where: { employeeId: createUserDto.employeeId },
      });
      if (existingEmployeeUser) {
        throw new ConflictException(
          'User account already exists for this employee',
        );
      }
    }

    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);

    const user = await this.prismaMaster.user.create({
      data: {
        ...createUserDto,
        password: hashedPassword,
      },
      include: {
        role: true,
      },
    });

    // Manually fetch employee data from Tenant DB if employeeId is present
    let employeeData: any = null;
    if (user.employeeId) {
      const employee = await this.prisma.employee.findUnique({
        where: { id: user.employeeId },
        select: {
          id: true,
          employeeName: true,
          departmentId: true,
          designationId: true,
        },
      });

      if (employee) {
        // Fetch Master data for labels
        const [dept, desg] = await Promise.all([
          this.prisma.department.findUnique({
            where: { id: employee.departmentId },
            select: { name: true },
          }),
          this.prisma.designation.findUnique({
            where: { id: employee.designationId },
            select: { name: true },
          }),
        ]);
        employeeData = {
          ...employee,
          department: dept,
          designation: desg,
        };
      }
    }

    return {
      ...user,
      employee: employeeData,
    };
  }

  async findAll() {
    const users = await this.prismaMaster.user.findMany({
      include: {
        role: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Collect all employee IDs to fetch from Tenant DB
    const employeeIds = users
      .map((u) => u.employeeId)
      .filter(Boolean) as string[];

    let employeeMap = new Map();
    if (employeeIds.length > 0) {
      const employees = await this.prisma.employee.findMany({
        where: { id: { in: employeeIds } },
        select: {
          id: true,
          employeeName: true,
          departmentId: true,
          designationId: true,
        },
      });

      // Fetch all unique Dept/Desg IDs
      const deptIds = [...new Set(employees.map((e) => e.departmentId))];
      const desgIds = [...new Set(employees.map((e) => e.designationId))];

      const [departments, designations] = await Promise.all([
        this.prisma.department.findMany({
          where: { id: { in: deptIds } },
          select: { id: true, name: true },
        }),
        this.prisma.designation.findMany({
          where: { id: { in: desgIds } },
          select: { id: true, name: true },
        }),
      ]);

      const deptMap = new Map(departments.map((d) => [d.id, d]));
      const desgMap = new Map(designations.map((d) => [d.id, d]));

      employeeMap = new Map(
        employees.map((e) => [
          e.id,
          {
            ...e,
            department: deptMap.get(e.departmentId) || null,
            designation: desgMap.get(e.designationId) || null,
          },
        ]),
      );
    }

    return users.map((user) => ({
      ...user,
      employee: user.employeeId
        ? employeeMap.get(user.employeeId) || null
        : null,
    }));
  }

  async findOne(id: string) {
    const user = await this.prismaMaster.user.findUnique({
      where: { id },
      include: {
        role: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    let employeeData: any = null;
    if (user.employeeId) {
      const employee = await this.prisma.employee.findUnique({
        where: { id: user.employeeId },
        select: {
          id: true,
          employeeName: true,
          departmentId: true,
          designationId: true,
        },
      });

      if (employee) {
        const [dept, desg] = await Promise.all([
          this.prisma.department.findUnique({
            where: { id: employee.departmentId },
            select: { name: true },
          }),
          this.prisma.designation.findUnique({
            where: { id: employee.designationId },
            select: { name: true },
          }),
        ]);
        employeeData = {
          ...employee,
          department: dept,
          designation: desg,
        };
      }
    }

    return {
      ...user,
      employee: employeeData,
    };
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.prismaMaster.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const { password, ...data } = updateUserDto;
    const updateData: any = { ...data };

    if (password) {
      updateData.password = await bcrypt.hash(password, 10);
    }

    return this.prismaMaster.user.update({
      where: { id },
      data: updateData,
      include: {
        role: true,
      },
    });
  }
}
