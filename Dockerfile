# Production Dockerfile for NestJS Backend
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Copy prisma files and config
COPY prisma ./prisma/
COPY prisma.config.ts ./

# Set dummy DATABASE_URL for build time (required by prisma.config.ts)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

RUN bun install

# Copy source code and build
COPY . .

# GENERATE PRISMA CLIENT HERE
# Using 'bun run' ensures we use the local prisma version and context
RUN bun run prisma:generate
RUN bun run build

# --- Production stage ---
FROM oven/bun:1-slim 

RUN apt-get update && apt-get install -y openssl wget postgresql-client docker.io && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Only copy what is needed
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/docker-entrypoint.sh ./

# Other files
COPY check-seed.ts countries.json city.json ./

RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["bun", "run", "start:prod"]
