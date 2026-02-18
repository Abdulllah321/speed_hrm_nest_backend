const fs = require('fs');
const path = require('path');

const sqlPath = path.join(__dirname, '../backup/master/master_data.sql');
const content = fs.readFileSync(sqlPath, 'utf8');
const lines = content.split('\n');

const allocations = [];
const departments = [];
const subDepartments = [];

const parseValues = (line) => {
    const valuePart = line.substring(line.indexOf('VALUES') + 7);
    // Remove enclosing parens and semi-colon
    const cleanValues = valuePart.trim().replace(/^\(|\);$/g, '');
    
    // Split by comma, respecting quotes
    const values = [];
    let current = '';
    let inQuote = false;
    
    for (let i = 0; i < cleanValues.length; i++) {
        const char = cleanValues[i];
        if (char === "'" && cleanValues[i-1] !== '\\') {
            inQuote = !inQuote;
        } else if (char === ',' && !inQuote) {
            values.push(cleanVal(current));
            current = '';
        } else {
            current += char;
        }
    }
    values.push(cleanVal(current));
    return values;
};

const cleanVal = (val) => {
    val = val.trim();
    if (val.startsWith("'") && val.endsWith("'")) {
        return val.substring(1, val.length - 1).replace(/''/g, "'");
    }
    if (val === 'NULL') return null;
    return val;
};

lines.forEach(line => {
    if (line.includes('INSERT INTO public."Allocation"')) {
        const vals = parseValues(line);
        allocations.push({
            id: vals[0],
            name: vals[1],
            status: vals[2],
            createdById: vals[3],
            createdAt: vals[4],
            updatedAt: vals[5]
        });
    } else if (line.includes('INSERT INTO public."Department"')) {
        const vals = parseValues(line);
        departments.push({
            id: vals[0],
            name: vals[1],
            allocationId: vals[2],
            headId: vals[3],
            createdById: vals[4],
            createdAt: vals[5],
            updatedAt: vals[6]
        });
    } else if (line.includes('INSERT INTO public."SubDepartment"')) {
        const vals = parseValues(line);
        subDepartments.push({
            id: vals[0],
            name: vals[1],
            departmentId: vals[2],
            headId: vals[3],
            createdById: vals[4],
            createdAt: vals[5],
            updatedAt: vals[6]
        });
    }
});

const output = {
    allocations,
    departments,
    subDepartments
};

console.error(`Found ${allocations.length} allocations, ${departments.length} departments, ${subDepartments.length} subDepartments`);

fs.writeFileSync(path.join(__dirname, '../prisma/seeds/data.json'), JSON.stringify(output, null, 2));
