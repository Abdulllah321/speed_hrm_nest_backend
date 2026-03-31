const fs = require('fs');

const filePath = 'd:\\projects\\speed-limit\\nestjs_backend\\backup\\companies\\tenant_speed_sport_mkzblxzg.sql';
let content = fs.readFileSync(filePath, 'utf-8');

const TODAY = new Date('2026-03-31');
const PROBATION_MONTHS = 3;

// Column index of probationExpiryDate in the INSERT (0-based)
// id, userId, employeeId, employeeName, fatherHusbandName, departmentId, subDepartmentId,
// employeeGradeId, attendanceId, designationId, maritalStatusId, employmentStatusId,
// probationExpiryDate(12), cnicNumber, cnicExpiryDate, lifetimeCnic,
// joiningDate(16), dateOfBirth, ...
const PROBATION_IDX = 12;
const JOINING_IDX = 16;

function parseValues(valuesStr) {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < valuesStr.length; i++) {
        const ch = valuesStr[i];
        if (ch === "'" && valuesStr[i - 1] !== '\\') {
            inQuotes = !inQuotes;
            current += ch;
        } else if (ch === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) values.push(current.trim());
    return values;
}

function addMonths(date, months) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
}

function pad(n) { return n.toString().padStart(2, '0'); }

function formatDate(d) {
    return `'${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}'`;
}

const lines = content.split('\n');
let updated = 0;
let alreadySet = 0;
let expired = 0;
let noJoining = 0;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith('INSERT INTO "Employee"')) continue;

    const valStart = line.indexOf('VALUES (') + 'VALUES ('.length;
    const valEnd = line.lastIndexOf(');');
    if (valStart === -1 || valEnd === -1) continue;

    const valuesStr = line.substring(valStart, valEnd);
    const values = parseValues(valuesStr);

    const probation = values[PROBATION_IDX];
    const joining = values[JOINING_IDX];

    // Skip if probationExpiryDate already set
    if (probation && probation !== 'NULL') {
        alreadySet++;
        continue;
    }

    // Skip if no joining date
    if (!joining || joining === 'NULL') {
        noJoining++;
        continue;
    }

    const joiningStr = joining.replace(/'/g, '');
    const joiningDate = new Date(joiningStr);
    if (isNaN(joiningDate.getTime())) {
        noJoining++;
        continue;
    }

    const probationExpiry = addMonths(joiningDate, PROBATION_MONTHS);
    values[PROBATION_IDX] = formatDate(probationExpiry);

    if (probationExpiry < TODAY) {
        expired++;
    }

    lines[i] = line.substring(0, valStart) + values.join(', ') + ');';
    updated++;
}

fs.writeFileSync(filePath, lines.join('\n'));

console.log(`Done.`);
console.log(`  Updated (probationExpiryDate set): ${updated}`);
console.log(`  Already had probationExpiryDate:   ${alreadySet}`);
console.log(`  Of updated, probation expired:     ${expired}`);
console.log(`  Skipped (no joining date):         ${noJoining}`);
