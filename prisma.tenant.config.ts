import 'dotenv/config'
import type { PrismaConfig } from 'prisma'
import { env } from 'prisma/config'

export default {
  schema: 'prisma/schema',
  migrations: {
    path: 'prisma/migrations-tenant',
  },
  datasource: {
    url: env('DATABASE_URL_TENANT'),
  },
} satisfies PrismaConfig


