# Stage 1: Dependencies
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
# Install dependencies including devDependencies (needed for nest build)
RUN bun install --frozen-lockfile

# Stage 2: Build
FROM oven/bun:1 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client
RUN bunx prisma generate

# Build the application
RUN bun run build

# Stage 3: Production Runner
FROM oven/bun:1 AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy necessary files
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/docker-entrypoint.sh ./
COPY --from=builder /app/check-seed.ts ./

# Set permissions
RUN chmod +x docker-entrypoint.sh

# Expose port
EXPOSE 3000

# Entrypoint to handle migrations if needed, or straight up start
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["bun", "run", "start:prod"]
