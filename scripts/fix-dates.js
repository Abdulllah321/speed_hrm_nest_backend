const fs = require('fs');

const path = './src/employee/employee.service.ts';
let content = fs.readFileSync(path, 'utf8');

const fixString = (bad, good) => {
    while (content.includes(bad)) {
        content = content.replace(bad, good);
    }
};

// Fix the exact broken string that currently exists in the file to the correct one
fixString('if (/^\\\\d{1,2}\\\\/\\\\d{ 1, 2 } \\\\/\\\\d{4}$/.test(dateStr)) {', 'if (/^\\\\d{1,2}\\\\/\\\\d{1,2}\\\\/\\\\d{4}$/.test(dateStr)) {');

fs.writeFileSync(path, content, 'utf8');
console.log('Fixed dates in employee.service.ts');
