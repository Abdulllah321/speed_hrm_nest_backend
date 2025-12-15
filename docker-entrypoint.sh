#!/bin/sh
set -e

echo "🔧 Setting up backend..."

# Generate Prisma client (always needed)
echo "📦 Generating Prisma client..."
bun run prisma:generate

# Push schema to database
echo "📊 Pushing database schema..."
bun run prisma:push

# Check if database is already seeded
echo "🔍 Checking if database needs seeding..."
if bun run check-seed.ts 2>/dev/null; then
  echo "✅ Database already seeded, skipping..."
else
  echo "🌱 Database not seeded, running seed..."
  bun run prisma:seed
fi

# Start the application
echo "🚀 Starting development server..."
exec "$@"
