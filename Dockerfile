# Stage 1: Build environment
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy dependency files
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source and prisma
COPY . .
RUN bunx prisma generate
RUN bun run build

# Stage 2: Production runner
FROM node:20-slim AS runner
WORKDIR /app

# Copy bun binary from official image
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun

ENV NODE_ENV=production

# Copy necessary files from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/docker-entrypoint.sh ./
COPY --from=builder /app/check-seed.ts ./

RUN chmod +x docker-entrypoint.sh

# Use existing 'node' user from the node:slim image or create one
# In node image, 'node' user usually exists. Let's make sure it has permissions.
RUN chown -R node:node /app

USER node
EXPOSE 3000

# Use bun to run the app for speed
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["bun", "run", "start:prod"]
