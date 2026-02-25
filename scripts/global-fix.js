const fs = require('fs');
const path = require('path');

function processDirectory(directory) {
    const files = fs.readdirSync(directory);
    for (const file of files) {
        const fullPath = path.join(directory, file);
        if (fs.statSync(fullPath).isDirectory()) {
            processDirectory(fullPath);
        } else if (fullPath.endsWith('.ts')) {
            let content = fs.readFileSync(fullPath, 'utf8');
            let originalContent = content;

            // 1. Fix leftover prismaMaster calls to prisma using exact string replace
            content = content.split('this.prismaMaster.').join('this.prisma.');

            // 2. Fix duplicate prisma injected in constructor
            content = content.split('private prisma: PrismaService,\\r\\n    private prisma: PrismaService,').join('private prisma: PrismaService,');
            content = content.split('private prisma: PrismaService,\\n    private prisma: PrismaService,').join('private prisma: PrismaService,');

            content = content.split('private readonly prisma: PrismaService,\\r\\n    private readonly prisma: PrismaService,').join('private readonly prisma: PrismaService,');
            content = content.split('private readonly prisma: PrismaService,\\n    private readonly prisma: PrismaService,').join('private readonly prisma: PrismaService,');

            content = content.split('private readonly prisma: PrismaService,\\r\\n    private prisma: PrismaService,').join('private readonly prisma: PrismaService,');
            content = content.split('private readonly prisma: PrismaService,\\n    private prisma: PrismaService,').join('private readonly prisma: PrismaService,');

            // Note: I will NOT replace lastName globally with regex because of the empty string matching bug!

            // 3. Simple relation assignments
            const regexes = [
                [/updateData\\.departmentId\\s+=\\s+([A-Za-z0-9_]+);/g, 'updateData.department = { connect: { id: $1 } };'],
                [/updateData\\.designationId\\s+=\\s+([A-Za-z0-9_]+);/g, 'updateData.designation = { connect: { id: $1 } };'],
                [/updateData\\.locationId\\s+=\\s+([A-Za-z0-9_]+);/g, 'updateData.location = { connect: { id: $1 } };'],
                [/updateData\\.workingHoursPolicyId\\s+=\\s+([A-Za-z0-9_]+);/g, 'updateData.workingHoursPolicy = { connect: { id: $1 } };'],
                [/updateData\\.leavesPolicyId\\s+=\\s+([A-Za-z0-9_]+);/g, 'updateData.leavesPolicy = { connect: { id: $1 } };'],
                [/updateData\\.socialSecurityInstitutionId\\s+=\\s+([A-Za-z0-9_]+);/g, 'updateData.socialSecurityInstitution = { connect: { id: $1 } };']
            ];

            for (const [regex, repl] of regexes) {
                content = content.replace(regex, repl);
            }

            if (content !== originalContent) {
                fs.writeFileSync(fullPath, content, 'utf8');
                console.log('Fixed globally: ' + fullPath);
            }
        }
    }
}

processDirectory(path.join(__dirname, '../src'));
