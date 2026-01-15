# Production Dockerfile for NestJS Backend
FROM oven/bun:1 AS builder

WORKDIR /app

# Set dummy DATABASE_URL for build time (required by Prisma)
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"

# Copy package files
COPY package.json bun.lock* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy prisma schema and config
COPY prisma ./prisma
COPY prisma.config.ts ./

# Generate Prisma client
RUN bun run prisma:generate

# Copy source code
COPY . .

# Build the application
RUN bun run build

# Production stage
FROM oven/bun:1-alpine

# Install OpenSSL for Prisma and wget for health checks
RUN apk add --no-cache openssl wget

WORKDIR /app

# Copy package files
COPY package.json bun.lock* ./

# Install production dependencies only
RUN bun install --production --frozen-lockfile

# Copy prisma schema and config
COPY prisma ./prisma
COPY prisma.config.ts ./

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Copy necessary files
COPY docker-entrypoint.sh /docker-entrypoint.sh
COPY check-seed.ts ./
COPY countries.json ./
COPY city.json ./

# Make entrypoint executable
RUN chmod +x /docker-entrypoint.sh

# Expose port
EXPOSE 3000

# Use entrypoint script
ENTRYPOINT ["/docker-entrypoint.sh"]

# Start production server
CMD ["bun", "run", "start:prod"]
