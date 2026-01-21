#!/bin/sh
set -e

echo "🔧 Setting up backend..."

# Explicitly check for schema path from config or fallback
PRISMA_SCHEMA="prisma/schema"

# Generate Prisma client (always needed)
echo "📦 Generating Prisma client..."
bun run prisma generate --schema "$PRISMA_SCHEMA"

# Push schema to database
echo "📊 Pushing database schema..."
bun run prisma db push --schema "$PRISMA_SCHEMA" --accept-data-loss

# Check if database is already seeded
echo "🔍 Checking if database needs seeding..."

# Verify pg_restore is available
if ! command -v pg_restore > /dev/null; then
  echo "⚠️  pg_restore not found! Please check Dockerfile installation."
else
  echo "✅ pg_restore is available."
fi

if bun run check-seed.ts 2>/dev/null; then
  echo "✅ Database already seeded, skipping..."
else
  echo "🌱 Database not seeded, running seed..."
  bun run prisma:seed
fi

# Start the application
echo "🚀 Starting server..."
exec "$@"
