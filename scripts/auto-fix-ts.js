const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Reading plain_tsc.log...');
if (!fs.existsSync('plain_tsc.log')) {
    console.log('plain_tsc.log not found');
    process.exit(1);
}
const outputRaw = fs.readFileSync('plain_tsc.log', 'utf16le');
const output = outputRaw.includes('\\0') ? outputRaw : fs.readFileSync('plain_tsc.log', 'utf8');
console.log('Build output read. Analyzing output...');

// The actual output format is `src/master/sale-pool/sale-pool.service.ts(1,66): error TS1435: Unknown keyword or identifier.`
const cleanOutput = output.replace(/[\\u001b\\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
const errorRegex = /(.*?\\.ts)\\((\\d+),(\\d+)\\):\\s*error\\s*(TS\\d+):\\s*(.*)/g;

let match;
const errorsByFile = {};

while ((match = errorRegex.exec(cleanOutput)) !== null) {
    const file = match[1].replace(/\\\\/g, '/');
    const line = parseInt(match[2], 10);
    const col = parseInt(match[3], 10);
    const code = match[4];
    const msg = match[5];

    if (!errorsByFile[file]) {
        errorsByFile[file] = [];
    }
    // prevent strict duplicates on same line
    if (!errorsByFile[file].find(e => e.line === line && e.code === code)) {
        errorsByFile[file].push({ line, col, code, msg });
    }
}

let filesFixed = 0;

for (const [file, errors] of Object.entries(errorsByFile)) {
    const fullPath = path.join(__dirname, '..', file);
    if (!fs.existsSync(fullPath)) continue;

    let lines = fs.readFileSync(fullPath, 'utf8').split('\\n');
    let changed = false;

    // Sort descending by line just in case, though we modify in place
    errors.sort((a, b) => b.line - a.line);

    for (const err of errors) {
        const lIdx = err.line - 1;
        if (lIdx < 0 || lIdx >= lines.length) continue;

        // TS2339: Property 'prismaMaster' does not exist
        if (err.code === 'TS2339' && err.msg.includes("'prismaMaster'")) {
            if (lines[lIdx].includes('prismaMaster')) {
                lines[lIdx] = lines[lIdx].replace(/prismaMaster/g, 'prisma');
                changed = true;
            }
        }

        // TS2300: Duplicate identifier 'prisma' OR 'PrismaService'
        if (err.code === 'TS2300' && (err.msg.includes("'prisma'") || err.msg.includes("'PrismaService'"))) {
            if (lines[lIdx].includes('prisma: PrismaService') || lines[lIdx].includes('import { PrismaService }')) {
                // Check if this line actually just says private prisma: PrismaService, and remove it
                lines[lIdx] = '// ' + lines[lIdx];
                changed = true;
            }
        }

        // TS2339: Property XYZ does not exist on type '{}' (creator/employee relations often miss firstName/lastName)
        if (err.code === 'TS2339' && (err.msg.includes("'firstName'") || err.msg.includes("'lastName'") || err.msg.includes("'employeeName'"))) {
            // If the line has creator.firstName or similar, let's fix it if it's a known pattern
            // The old code used creator.firstName creator.lastName, new Employee model has employeeName
            if (lines[lIdx].includes('firstName') || lines[lIdx].includes('lastName')) {
                lines[lIdx] = lines[lIdx].replace(/([^\\s\\.()]+)\\.firstName/g, '$1.employeeName');
                lines[lIdx] = lines[lIdx].replace(/([^\\s\\.()]+)\\.lastName/g, '""'); // just empty string for last name since it's merged
                changed = true;
            }
        }

        // TS2551: Property 'departmentId' does not exist on type 'EmployeeUpdateInput'. Did you mean 'department'?
        if (err.code === 'TS2551' && err.msg.includes('Did you mean')) {
            const matchMsg = /Property '(.*?)' does not exist.*Did you mean '(.*?)'/.exec(err.msg);
            if (matchMsg) {
                const wrong = matchMsg[1];
                const right = matchMsg[2];
                // Be careful replacing this. But usually it's `updateData.departmentId = ...`
                if (lines[lIdx].includes(wrong)) {
                    // For relations in prisma create/update, you usually need { connect: { id: ... } }
                    // if it's simple assignment like `updateData.departmentId = id`
                    // -> `updateData.department = { connect: { id } }`
                    if (lines[lIdx].includes('updateData.' + wrong + '=')) {
                        // This is complex to regex, let's just do a naive replace
                        lines[lIdx] = lines[lIdx].replace(new RegExp('updateData\\\\.' + wrong + '\\\\s*=\\\\s*(.*)?;?'), 'updateData.' + right + ' = { connect: { id: $1 } };');
                        changed = true;
                    }
                    // If it's a spread or direct object like \`departmentId: existing.departmentId\`
                    else if (lines[lIdx].includes(wrong + ':')) {
                        // don't try to auto fix complex objects automatically here safely
                    }
                }
            }
        }

        // TS1435: Unknown keyword or identifier. Did you mean 'import'?
        // TS1434: Unexpected keyword or identifier.
        // TS1127: Invalid character.
        // Typically caused by our \nimport mistake
        if (['TS1435', 'TS1434', 'TS1127', 'TS2304'].includes(err.code)) {
            if (lines[lIdx].includes('\\\\nimport')) {
                lines[lIdx] = lines[lIdx].replace(/\\\\nimport/g, '');
                changed = true;
            }
            if (lines[lIdx].includes('\\nimport')) {
                // raw literal \n in file
                lines[lIdx] = lines[lIdx].replace(/\\nimport/g, '');
                changed = true;
            }
        }
    }

    // Global passes for files that are definitely busted by our script:
    for (let i = 0; i < lines.length; i++) {
        // A common literal string: \nimport { PrismaService } from '../../database/prisma.service';\nimport ...
        if (lines[i].includes('\\\\nimport { PrismaService }')) {
            lines[i] = lines[i].replace(/\\\\nimport \{ PrismaService \} from ['"](.*?)['"];?(?:\\\\n)?/g, "");
            lines[0] = "import { PrismaService } from '../../database/prisma.service';" + "\\n" + lines[0];
            changed = true;
        }

        // Deal with \n at the very start of line 1
        if (i === 0 && lines[0].startsWith('\\n')) {
            lines[0] = lines[0].substring(2);
            changed = true;
        }
        if (i === 0 && lines[0].startsWith('\\\\n')) {
            lines[0] = lines[0].substring(2);
            changed = true;
        }

        if (lines[i].includes('private prisma: PrismaService,private')) {
            lines[i] = lines[i].replace('private prisma: PrismaService,private', 'private prisma: PrismaService, private');
            changed = true;
        }

        if (lines[i].includes('private prisma: PrismaService, private prisma: PrismaService')) {
            lines[i] = lines[i].replace('private prisma: PrismaService, private prisma: PrismaService', 'private prisma: PrismaService');
            changed = true;
        }
    }

    if (changed) {
        fs.writeFileSync(fullPath, lines.join('\\n'), 'utf8');
        filesFixed++;
        console.log('Auto-fixed: ' + file);
    }
}

console.log('Done fixing local errors across ' + filesFixed + ' files.');

