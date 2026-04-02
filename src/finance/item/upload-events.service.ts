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

    constructor(private eventEmitter: EventEmitter2) { }

    emit(event: UploadEvent) {
        this.eventEmitter.emit(`upload.${event.uploadId}`, event);
    }

    subscribe(uploadId: string): Observable<MessageEvent> {
        const events$ = fromEvent(this.eventEmitter, `upload.${uploadId}`).pipe(
            map((event: UploadEvent) => ({ data: event }) as MessageEvent)
        );

        // Heartbeat every 20s — prevents Nginx/proxy from closing idle SSE connections
        // during long silent phases (e.g. master data warm-up, large file parsing)
        const heartbeat$ = timer(15000, 20000).pipe(
            map(() => ({ data: { type: 'heartbeat', uploadId } }) as MessageEvent)
        );

        return merge(events$, heartbeat$);
    }
}
