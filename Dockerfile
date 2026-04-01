# --- Build stage ---
FROM oven/bun:1 AS builder

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Copy prisma files and config
COPY prisma ./prisma/
COPY prisma.config.ts ./
COPY prisma.master.config.ts ./

# Set dummy DATABASE_URL for build time (required by prisma.config.ts)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

RUN bun install

# Generate Prisma client
RUN bun run prisma:master:generate
RUN bun run prisma:tenant:generate 

# Copy source code and build
COPY . .
RUN bun run build

# --- Production stage ---
FROM oven/bun:1-slim

# Install required tools: openssl, wget, postgresql-client (for pg_restore)
RUN apt-get update && \
    apt-get install -y openssl wget postgresql-client && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only necessary files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./
COPY --from=builder /app/prisma.master.config.ts ./
COPY --from=builder /app/docker-entrypoint.sh ./

# Other necessary# Other files
# Copy individual files
COPY check-seed.ts ./

# Copy scripts folder
COPY scripts/ ./scripts/

# Copy backup folder
COPY backup/ ./backup/

# Copy update-permission.ts
COPY src/config/permissions.ts ./src/config/permissions.ts

RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["bun", "run", "start:prod"]