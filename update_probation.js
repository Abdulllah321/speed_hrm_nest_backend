const fs = require('fs');

const filePath = 'd:\\projects\\speed-limit\\nestjs_backend\\backup\\companies\\tenant_speed_sport_mkzblxzg.sql';
let content = fs.readFileSync(filePath, 'utf-8');

const lines = content.split('\n');

let updatedLines = 0;
// Only rows 8 to 282, which means indices 7 to 281
for (let i = 7; i <= 281; i++) {
    let line = lines[i];
    if (line.startsWith('INSERT INTO public."Employee"')) {
        const valuesStartList = line.indexOf('VALUES (') + 'VALUES ('.length;
        const valuesEndList = line.lastIndexOf(');');
        if (valuesStartList !== -1 && valuesEndList !== -1) {
            const valuesStr = line.substring(valuesStartList, valuesEndList);

            let values = [];
            let current = '';
            let inQuotes = false;
            for (let j = 0; j < valuesStr.length; j++) {
                const char = valuesStr[j];
                if (char === "'") {
                    inQuotes = !inQuotes;
                    current += char;
                } else if (char === ',' && !inQuotes) {
                    values.push(current.trim());
                    current = '';
                } else {
                    current += char;
                }
            }
            if (current !== '') {
                values.push(current.trim());
            }

            const joiningDateRaw = values[16];
            if (joiningDateRaw && joiningDateRaw !== 'NULL') {
                const joiningDateStr = joiningDateRaw.replace(/'/g, '');

                // Parse date string like '2000-10-04 19:00:00' or '2000-10-04 00:00:00'
                const [datePart, timePart] = joiningDateStr.split(' ');
                if (datePart && timePart) {
                    const [year, month, day] = datePart.split('-');
                    const [hour, minute, second] = timePart.split(':');

                    const date = new Date(year, month - 1, day, hour, minute, second);
                    date.setMonth(date.getMonth() + 3);

                    const pad = (n) => n.toString().padStart(2, '0');
                    const newDateStr = `'${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}'`;

                    // probationExpiryDate is index 12 in columns list
                    values[12] = newDateStr;

                    const newValuesStr = values.join(', ');
                    lines[i] = line.substring(0, valuesStartList) + newValuesStr + ');';
                    updatedLines++;
                }
            }
        }
    }
}

fs.writeFileSync(filePath, lines.join('\n'));
console.log('Done, updated ' + updatedLines + ' lines');
