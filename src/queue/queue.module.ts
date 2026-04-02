import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bull';

@Module({
    imports: [
        BullModule.forRootAsync({
            useFactory: () => {
                try {
                    if (process.env.NO_REDIS === 'true') {
                        console.log('Bull queue disabled via NO_REDIS');
                        return {
                            redis: {
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
                            attempts: 1,           // Never retry bulk jobs — retrying causes duplicate inserts
                            timeout: 4 * 60 * 60 * 1000, // 4 hour timeout — enough for 3 lakh records
                            removeOnComplete: false,
                            removeOnFail: false,
                        }
                    };
                } catch (error) {
                    console.error('Failed to configure Bull queue. Check your Redis connection.', error);
                    return { redis: { host: 'localhost', port: 65535, maxRetriesPerRequest: 0 } };
                }
            }
        }),
    ],
    exports: [BullModule],
})
export class QueueModule { }
