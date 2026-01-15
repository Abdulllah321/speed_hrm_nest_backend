import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: 'prisma/schema',
  migrations: {
    seed: 'bun ./prisma/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL || 'postgresql://dummy:dummy@localhost:5432/dummy'
  }
});
