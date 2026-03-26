const fs = require('fs');
const path = require('path');

const movedModels = [
    'designation', 'category', 'uom', 'allocation', 'jobType', 'institute', 'qualification', 'maritalStatus', 'degreeType', 'country', 'city', 'state', 'allowanceHead', 'deductionHead', 'loanType', 'leaveType', 'leavesPolicy', 'leavesPolicyLeaveType', 'equipment', 'salaryBreakup', 'taxSlab', 'bonusType', 'approvalSetting', 'department', 'subDepartment', 'eOBI', 'employeeGrade', 'employeeStatus', 'providentFund', 'workingHoursPolicy', 'fileUpload', 'holiday', 'bank', 'taxRate1', 'rebateNature', 'socialSecurityInstitution', 'socialSecurityEmployerRegistration', 'socialSecurityEmployeeRegistration', 'socialSecurityContribution', 'companyGroup', 'salePool', 'saleType', 'salesman', 'storageDimension', 'machine', 'brand', 'division', 'gender', 'size', 'silhouette', 'channelClass', 'color', 'segment', 'itemClass', 'itemSubclass', 'season', 'oldSeason', 'location', 'pos', 'posSession'
];

function processDirectory(directory) {
    const files = fs.readdirSync(directory);
    for (const file of files) {
        const fullPath = path.join(directory, file);
        if (fs.statSync(fullPath).isDirectory()) {
            processDirectory(fullPath);
        } else if (fullPath.endsWith('.ts')) {
            processFile(fullPath);
        }
    }
}

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let originalContent = content;

    // Does this file use this.prisma.[model]?
    let usesPrismaForMovedModel = false;
    for (const m of movedModels) {
        if (content.includes('this.prisma.' + m)) {
            usesPrismaForMovedModel = true;
            break;
        }
    }

    // Also check if it's the upload service or similar which uses fileUpload
    if (content.includes('this.prisma.fileUpload')) usesPrismaForMovedModel = true;

    if (usesPrismaForMovedModel) {
        let changed = false;

        const replacements = [
            ['private prismaMaster: PrismaMasterService', 'private prisma: PrismaService'],
            ['private readonly prismaMaster: PrismaMasterService', 'private readonly prisma: PrismaService'],
            ['private prisma: PrismaMasterService', 'private prisma: PrismaService'],
            ['private readonly prisma: PrismaMasterService', 'private readonly prisma: PrismaService']
        ];

        for (const [search, replace] of replacements) {
            if (content.includes(search)) {
                content = content.replace(search, replace);
                changed = true;
            }
        }

        if (!content.includes('prisma: PrismaService')) {
            const cIndex = content.indexOf('constructor(') > -1 ? content.indexOf('constructor(') : content.indexOf('constructor (');
            if (cIndex !== -1) {
                const insertPos = content.indexOf('(', cIndex) + 1;
                content = content.slice(0, insertPos) + '\\n    private readonly prisma: PrismaService,' + content.slice(insertPos);
                changed = true;
            }
        }

        if (changed || (!content.includes('PrismaService') && content.includes('this.prisma'))) {
            if (!content.includes('import { PrismaService }')) {
                const parts = filePath.split(path.sep);
                const srcIndex = parts.indexOf('src');
                let depth = parts.length - srcIndex - 2;
                if (depth < 0) depth = 0;
                let relPath = '';
                for (let i = 0; i < depth; i++) relPath += '../';
                if (relPath === '') relPath = './';

                const importStr = "\\nimport { PrismaService } from '" + relPath + "database/prisma.service';\\n";

                const lastImportIndex = content.lastIndexOf('import ');
                if (lastImportIndex !== -1) {
                    const endOfLine = content.indexOf('\\n', lastImportIndex);
                    content = content.slice(0, endOfLine + 1) + importStr + content.slice(endOfLine + 1);
                } else {
                    content = importStr + content;
                }
            }
        }

        if (content !== originalContent) {
            fs.writeFileSync(filePath, content, 'utf8');
            console.log('Fixed constructor in: ' + filePath);
        }
    }
}

processDirectory(path.join(__dirname, '../src'));
console.log('Done fixing constructors.');
