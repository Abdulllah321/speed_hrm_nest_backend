import 'dotenv/config';
import type { PrismaConfig } from 'prisma';
import { env } from 'prisma/config';

export default {
  schema: 'prisma/master/schema.prisma',
  migrations: {
    path: 'prisma/migrations-master',
    seed: 'bun ./prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL_MANAGEMENT'),
  },
} satisfies PrismaConfig;
