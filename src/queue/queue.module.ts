import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

@Module({
    imports: [
        BullModule.forRootAsync({
            useFactory: () => {
                if (process.env.NO_REDIS === 'true') {
                    console.log('Bull queue disabled via NO_REDIS');
                    return {
                        redis: {
                            // Dummy connection that will fail fast if ever used, but allows module to init
                            host: 'localhost',
                            port: 65535,
                            maxRetriesPerRequest: 0,
                            enableOfflineQueue: false
                        }
                    };
                }

                return {
                    redis: {
                        host: process.env.REDIS_HOST || '127.0.0.1',
                        port: parseInt(process.env.REDIS_PORT || '6379'),
                    },
                    defaultJobOptions: {
                        attempts: 3,
                        backoff: {
                            type: 'exponential',
                            delay: 2000,
                        },
                        removeOnComplete: false, // Keep completed jobs for history
                        removeOnFail: false, // Keep failed jobs for debugging
                    }
                };
            }
        }),
    ],
    exports: [BullModule],
})
export class QueueModule { }
