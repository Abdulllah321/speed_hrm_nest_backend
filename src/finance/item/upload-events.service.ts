import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable, fromEvent, map, filter } from 'rxjs';

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
        return fromEvent(this.eventEmitter, `upload.${uploadId}`).pipe(
            map((event: UploadEvent) => {
                return {
                    data: event,
                } as MessageEvent;
            })
        );
    }
}
