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

            // Fix literal '\n' escaping issues like `\nimport { PrismaService } from ...`
            if (content.includes('\\\\nimport')) {
                content = content.replace(/\\\\nimport/g, '\\nimport');
                // If the file now inexplicably starts with a newline, let's keep it or trim it
                if (content.startsWith('\\n')) {
                    content = content.substring(1);
                }
            }

            // Also clean up duplicated imports if they exist
            if (content.includes('import { PrismaService } from \\'../../ database / prisma.service\\';\\nimport { PrismaService } from \\'../../ database / prisma.service\\';')) {
                content = content.replace('import { PrismaService } from \\'../../ database / prisma.service\\';\\nimport { PrismaService } from \\'../../ database / prisma.service\\';', 'import { PrismaService } from \\'../../ database / prisma.service\\';');
            }

            if (content !== originalContent) {
                fs.writeFileSync(fullPath, content, 'utf8');
                console.log("Fixed newline imports in: " + fullPath);
            }
        }
    }
}

processDirectory(path.join(__dirname, '../src'));
