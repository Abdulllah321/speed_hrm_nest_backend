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
  let modified = false;

  for (const model of movedModels) {
    const searchStr = 'this.prismaMaster.' + model;
    const replaceStr = 'this.prisma.' + model;
    if (content.includes(searchStr)) {
      content = content.replaceAll(searchStr, replaceStr);
      modified = true;
    }
  }

  if (modified) {
    if (!content.includes('PrismaService')) {
      if (content.includes('PrismaMasterService')) {
        content = content.replace(/(import .* PrismaMasterService .*;)((?:\\r?\\n)?)/, "$1\\nimport { PrismaService } from '../../database/prisma.service';\\n");
      }
    }

    if (!content.includes('private prisma: PrismaService') && !content.includes('private readonly prisma: PrismaService')) {
      const constructorRegex = /constructor\\s*\\([^)]*\\)\\s*\\{/;
      const match = content.match(constructorRegex);
      if (match) {
        // Simple heuristic to inject into constructor
        content = content.replace(/(constructor\\s*\\()([^)]*\\)\\s*\\{)/, "$1private prisma: PrismaService, $2");
      }
    }
  }

  if (content !== originalContent) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log("Updated: " + filePath);
  }
}

processDirectory(path.join(__dirname, '../src'));
console.log('Done scanning and replacing.');
