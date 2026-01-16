
import 'dotenv/config'
import type { PrismaConfig } from "prisma";
import { env } from "prisma/config";

export default {
  schema: "prisma/schema",
  migrations: {
    path: "prisma/migrations",
    seed: 'bun ./prisma/seed.ts',
  },
  datasource: { 
    url: env("DATABASE_URL") 
  }
} satisfies PrismaConfig;