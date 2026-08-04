import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable, fromEvent, map, merge, timer } from 'rxjs';

export interface UploadEvent {
    uploadId: string;
    type: 'progress' | 'status' | 'completed' | 'failed';
    data: any;
}

@Injectable()
export class UploadEventsService {
    private readonly logger = new Logger(UploadEventsService.name);

    constructor(private eventEmitter: EventEmitter2,) { }

    emit(event: UploadEvent) {
        this.eventEmitter.emit(`upload.${event.uploadId}`, event);
    }

    subscribe(uploadId: string): Observable<MessageEvent> {
        const events$ = fromEvent(this.eventEmitter, `upload.${uploadId}`).pipe(
            map((event: UploadEvent) => ({ data: event }) as MessageEvent)
        );

        // Heartbeat every 10s — keeps SSE connections 100% alive through Nginx, Next.js proxy,
        // and browser tab throttling during long parsing/validation phases (e.g. 23k row files)
        const heartbeat$ = timer(5000, 10000).pipe(
            map(() => ({ data: { type: 'heartbeat', uploadId } }) as MessageEvent)
        );

        return merge(events$, heartbeat$);
    }
}
