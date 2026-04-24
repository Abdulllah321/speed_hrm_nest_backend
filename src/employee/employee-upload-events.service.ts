import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable, fromEvent, map, merge, timer } from 'rxjs';

export interface UploadEvent {
    uploadId: string;
    type: 'progress' | 'status' | 'completed' | 'failed';
    data: any;
}

@Injectable()
export class EmployeeUploadEventsService {
    private readonly logger = new Logger(EmployeeUploadEventsService.name);

    constructor(private eventEmitter: EventEmitter2) { }

    emit(event: UploadEvent) {
        this.eventEmitter.emit(`employee-upload.${event.uploadId}`, event);
    }

    subscribe(uploadId: string): Observable<MessageEvent> {
        const events$ = fromEvent(this.eventEmitter, `employee-upload.${uploadId}`).pipe(
            map((event: UploadEvent) => ({ data: event }) as MessageEvent)
        );

        const heartbeat$ = timer(15000, 20000).pipe(
            map(() => ({ data: { type: 'heartbeat', uploadId } }) as MessageEvent)
        );

        return merge(events$, heartbeat$);
    }
}
