#!/bin/sh
set -e

echo "🔧 Setting up backend..."

# Explicitly check for schema path from config or fallback
PRISMA_SCHEMA="prisma/schema"

# Generate Prisma client (always needed)
echo "📦 Generating Prisma client..."
bunx prisma generate --schema "$PRISMA_SCHEMA"

# Push schema to database
echo "📊 Pushing database schema..."
bunx prisma db push --schema "$PRISMA_SCHEMA" --accept-data-loss

# Check if database is already seeded
echo "🔍 Checking if database needs seeding..."
if bun run check-seed.ts 2>/dev/null; then
  echo "✅ Database already seeded, skipping..."
else
  echo "🌱 Database not seeded, running seed..."
  bunx prisma db seed
fi

# Start the application
echo "🚀 Starting server..."
exec "$@"
