"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const config_1 = require("prisma/config");
exports.default = {
    schema: 'prisma/master/schema.prisma',
    migrations: {
        path: 'prisma/migrations-master',
        seed: 'bun ./prisma/seed.ts',
    },
    datasource: {
        url: (0, config_1.env)('DATABASE_URL_MANAGEMENT'),
    },
};
//# sourceMappingURL=prisma.master.config.js.map