# Production Dockerfile for NestJS Backend
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy prisma files and config
COPY prisma ./prisma/
COPY prisma.config.ts ./

# GENERATE PRISMA CLIENT HERE (No DATABASE_URL needed for generation usually)
RUN bunx prisma generate

# Copy source code and build
COPY . .
RUN bun run build

# --- Production stage ---
FROM oven/bun:1-slim 

RUN apt-get update && apt-get install -y openssl wget && rm -rf /var/lib/apt/lists/*

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