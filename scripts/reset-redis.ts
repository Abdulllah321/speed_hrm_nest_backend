import Redis from 'ioredis';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from nestjs_backend/.env
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const host = process.env.REDIS_HOST || '127.0.0.1';
const port = parseInt(process.env.REDIS_PORT || '6379', 10);
const password = process.env.REDIS_PASSWORD || undefined;

async function resetRedis() {
  console.log(`\n==============================================`);
  console.log(`🧹 Connecting to Redis/Memurai at ${host}:${port}...`);
  console.log(`==============================================`);

  const redis = new Redis({
    host,
    port,
    password,
    connectTimeout: 3000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null, // Do not reconnect on failure
  });

  redis.on('error', (err) => {
    // Suppress unhandled error log, handled in try/catch below
  });

  try {
    await redis.ping();
    console.log(`✅ Connected successfully!`);

    const keys = await redis.keys('*');
    const bullKeys = keys.filter((k) => k.startsWith('bull:'));
    const cacheKeys = keys.filter((k) => !k.startsWith('bull:'));

    console.log(`\n📊 Existing Redis State:`);
    console.log(`   - Total Keys:      ${keys.length}`);
    console.log(`   - Bull Queue Keys: ${bullKeys.length}`);
    console.log(`   - Cache/Other Keys:${cacheKeys.length}`);

    if (bullKeys.length > 0) {
      console.log(`\n📦 Active/Stalled Queues detected:`);
      const queues = Array.from(
        new Set(bullKeys.map((k) => k.split(':')[1])),
      );
      queues.forEach((q) => console.log(`   • ${q}`));
    }

    console.log(`\n⚡ Executing FLUSHALL (purging all databases and queues)...`);
    const flushResult = await redis.flushall();

    if (flushResult === 'OK') {
      const remainingKeys = await redis.dbsize();
      console.log(`\n✨ Redis has been completely reset!`);
      console.log(`   - Keys Remaining: ${remainingKeys}`);
      console.log(`==============================================\n`);
    } else {
      console.warn(`⚠️ FLUSHALL returned: ${flushResult}`);
    }
  } catch (error: any) {
    console.error(`\n❌ Failed to reset Redis:`, error.message || error);
    console.log(`\n💡 Tips:`);
    console.log(`   1. Make sure Redis / Memurai is running.`);
    console.log(`   2. You can start Memurai by running:`);
    console.log(`      npm run redis:start`);
    console.log(`      or execute: "C:\\Program Files\\Memurai\\memurai.exe" --port 6379\n`);
    process.exit(1);
  } finally {
    redis.disconnect();
  }
}

resetRedis();
