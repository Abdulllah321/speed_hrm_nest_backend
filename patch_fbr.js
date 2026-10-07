const fs = require('fs');

const splPath = 'f:/HRM-abdullah/speed-limit/nestjs_backend/src/pos-sales/pos-sales.service.ts';
const ivarPath = 'f:/HRM-abdullah/speed-limit/nestjs_backend/src/pos-sales/pos-sales.service.ivar.txt';

let splCode = fs.readFileSync(splPath, 'utf8');
const ivarCode = fs.readFileSync(ivarPath, 'utf8');

// 1. Extract syncWithFbr from ivar
const syncWithFbrRegex = /  private async syncWithFbr\([\s\S]*?^  \}/m;
const matchSync = ivarCode.match(syncWithFbrRegex);
const ivarSyncWithFbr = matchSync ? matchSync[0] : null;

// 2. Extract syncReturnWithFbr from ivar
const syncReturnWithFbrRegex = /  private async syncReturnWithFbr\([\s\S]*?^  \}/m;
const matchReturnSync = ivarCode.match(syncReturnWithFbrRegex);
const ivarSyncReturnWithFbr = matchReturnSync ? matchReturnSync[0] : null;

// 3. Extract isNonZeroHsCode from ivar
const isNonZeroHsCodeRegex = /  private isNonZeroHsCode\([\s\S]*?^  \}/m;
const matchHsCode = ivarCode.match(isNonZeroHsCodeRegex);
const ivarIsNonZeroHsCode = matchHsCode ? matchHsCode[0] : null;

if (!ivarSyncWithFbr || !ivarSyncReturnWithFbr || !ivarIsNonZeroHsCode) {
    console.error("Failed to extract methods from ivar");
    process.exit(1);
}

// 4. Replace syncWithFbr in spl
const splSyncWithFbrRegex = /  private async syncWithFbr\([\s\S]*?^  \}/m;
if (splSyncWithFbrRegex.test(splCode)) {
    splCode = splCode.replace(splSyncWithFbrRegex, ivarSyncWithFbr + '\n\n' + ivarSyncReturnWithFbr + '\n\n' + ivarIsNonZeroHsCode);
    console.log("Successfully replaced syncWithFbr and added syncReturnWithFbr + isNonZeroHsCode");
} else {
    console.error("Failed to find syncWithFbr in spl");
    process.exit(1);
}

// Let's also patch `createReturn` to include the FBR sync.
// In ivar, it looks like:
// const fbrReturnResult = await this.syncReturnWithFbr(...);
// Let's just save for now and then we can check.
fs.writeFileSync(splPath, splCode, 'utf8');
console.log("File patched!");
