"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const config_1 = require("prisma/config");
exports.default = {
    schema: "prisma/schema",
    migrations: {
        path: "prisma/migrations",
        seed: 'bun ./prisma/seed.ts',
    },
    datasource: {
        url: (0, config_1.env)("DATABASE_URL")
    }
};
//# sourceMappingURL=prisma.config.js.map