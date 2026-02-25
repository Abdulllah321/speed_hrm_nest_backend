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
            let changed = false;

            // Fix literal '\n' injected incorrectly
            if (content.includes("\\nimport { PrismaService } from '../../database/prisma.service';\\n")) {
                content = content.replace(/\\nimport \{ PrismaService \} from '\.\.\/\.\.\/database\/prisma\.service';\\n/g,
                    "\\nimport { PrismaService } from '../../database/prisma.service';\\n"
                );
                content = content.split("\\nimport { PrismaService } from '../../database/prisma.service';\\n").join("\nimport { PrismaService } from '../../database/prisma.service';\n");
                changed = true;
            }

            // Fix instances where PrismaService is used but hasn't been injected correctly in some services (missing comma, etc)
            // Or just fix the class constructor if it's broken 'constructor(private prisma: PrismaService,private'
            if (content.includes("private prisma: PrismaService,private")) {
                content = content.replaceAll("private prisma: PrismaService,private", "private prisma: PrismaService, private");
                changed = true;
            }

            if (changed) {
                fs.writeFileSync(fullPath, content, 'utf8');
                console.log("Fixed: " + fullPath);
            }
        }
    }
}
processDirectory(path.join(__dirname, '../src'));
