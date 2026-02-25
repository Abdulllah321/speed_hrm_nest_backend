const fs = require('fs');
const file = 'd:/projects/speed-limit/nestjs_backend/src/master/department/department.service.ts';
let code = fs.readFileSync(file, 'utf8');

// Global replaces:
code = code.replace(/this\.prismaMaster\.department/g, 'this.prisma.department');
code = code.replace(/this\.prismaMaster\.subDepartment/g, 'this.prisma.subDepartment');

// Replace getAllDepartments
code = code.replace(/async getAllDepartments\(\) \{[\s\S]*?return \{ status: true, data \};\n  \}/, `async getAllDepartments() {
    const cacheKey = 'departments_all';
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return { status: true, data: cachedData };
    }

    this.prisma.ensureTenantContext();
    const departments = await this.prisma.department.findMany({
      include: {
        head: { select: { employeeId: true, employeeName: true } },
        subDepartments: {
          include: {
            head: { select: { employeeId: true, employeeName: true } },
          }
        },
        allocation: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Fetch Master Users manually because User is in master DB
    const userIds = [
      ...new Set(departments.map((d) => d.createdById).filter(Boolean)),
    ];

    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, firstName: true, lastName: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = departments.map((dept) => {
      const creator = dept.createdById ? userMap.get(dept.createdById) : null;
      const head = dept.head;      

      return {
        ...dept,
        createdBy: creator
          ? \`\${creator.firstName} \${creator.lastName || ''}\`.trim()
          : null,
        headName: head ? \`\${head.employeeName} (\${head.employeeId})\` : null,
        allocationName: dept.allocation ? dept.allocation.name : null,
        subDepartments: dept.subDepartments.map((sd) => {
          const sdHead = sd.head;
          return {
            ...sd,
            headName: sdHead
              ? \`\${sdHead.employeeName} (\${sdHead.employeeId})\`
              : null,
          };
        }),
      };
    });

    await this.cacheManager.set(cacheKey, data, 3600000); // 1 hour TTL
    return { status: true, data };
  }`);

// Replace getDepartmentById
code = code.replace(/async getDepartmentById\(id: string\) \{[\s\S]*?return \{ status: true, data \};\n  \}/, `async getDepartmentById(id: string) {
    this.prisma.ensureTenantContext();
    const department: any = await this.prisma.department.findUnique({
      where: { id },
      include: {
        head: { select: { employeeId: true, employeeName: true } },
        subDepartments: {
          include: {
            head: { select: { employeeId: true, employeeName: true } },
          }
        },
        allocation: { select: { id: true, name: true } },
      },
    });
    if (!department) return { status: false, message: 'Department not found' };

    const userIds = [department.createdById].filter(Boolean) as string[];

    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, firstName: true, lastName: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    const creator = department.createdById
      ? userMap.get(department.createdById)
      : null;
    const head = department.head;

    const data = {
      ...department,
      createdBy: creator
        ? \`\${creator.firstName} \${creator.lastName || ''}\`.trim()
        : null,
      headName: head ? \`\${head.employeeName} (\${head.employeeId})\` : null,
      allocationName: department.allocation ? department.allocation.name : null,
      subDepartments: department.subDepartments.map((sd: any) => {
        const sdHead = sd.head;
        return {
          ...sd,
          headName: sdHead
            ? \`\${sdHead.employeeName} (\${sdHead.employeeId})\`
            : null,
        };
      }),
    };
    return { status: true, data };
  }`);

// Replace getAllSubDepartments
code = code.replace(/async getAllSubDepartments\(\) \{[\s\S]*?message: 'Sub-departments fetched successfully',\n    \};\n  \}/, `async getAllSubDepartments() {
    const cacheKey = 'subdepartments_all';
    const cachedData = await this.cacheManager.get(cacheKey);
    if (cachedData) {
      return {
        status: true,
        data: cachedData,
        message: 'Sub-departments fetched successfully',
      };
    }

    this.prisma.ensureTenantContext();
    const subDepartments = await this.prisma.subDepartment.findMany({
      include: {
        department: true,
        head: { select: { employeeId: true, employeeName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [
      ...new Set(subDepartments.map((sd) => sd.createdById).filter(Boolean)),
    ];

    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, firstName: true, lastName: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = subDepartments.map((sd: any) => {
      const creator = sd.createdById ? userMap.get(sd.createdById) : null;
      const head = sd.head;

      return {
        ...sd,
        departmentName: sd.department.name,
        createdBy: creator
          ? \`\${creator.firstName} \${creator.lastName || ''}\`.trim()
          : null,
        headName: head ? \`\${head.employeeName} (\${head.employeeId})\` : null,
      };
    });

    await this.cacheManager.set(cacheKey, data, 3600000);
    return {
      status: true,
      data,
      message: 'Sub-departments fetched successfully',
    };
  }`);

// Replace getSubDepartmentsByDepartment
code = code.replace(/async getSubDepartmentsByDepartment\(departmentId: string\) \{[\s\S]*?message: 'Sub-departments fetched successfully',\n    \};\n  \}/, `async getSubDepartmentsByDepartment(departmentId: string) {
    this.prisma.ensureTenantContext();
    const subDepartments = await this.prisma.subDepartment.findMany({
      where: { departmentId },
      include: {
        department: true,
        head: { select: { employeeId: true, employeeName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const userIds = [
      ...new Set(subDepartments.map((sd) => sd.createdById).filter(Boolean)),
    ];

    const users = await this.prismaMaster.user.findMany({
      where: { id: { in: userIds as string[] } },
      select: { id: true, firstName: true, lastName: true },
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    const data = subDepartments.map((sd: any) => {
      const creator = sd.createdById ? userMap.get(sd.createdById) : null;
      const head = sd.head;

      return {
        ...sd,
        departmentName: sd.department.name,
        createdBy: creator
          ? \`\${creator.firstName} \${creator.lastName || ''}\`.trim()
          : null,
        headName: head ? \`\${head.employeeName} (\${head.employeeId})\` : null,
      };
    });
    return {
      status: true,
      data,
      message: 'Sub-departments fetched successfully',
    };
  }`);

fs.writeFileSync(file, code);
console.log('Refactoring complete!');
