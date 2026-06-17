import { Controller, Sse, MessageEvent, Param, Query, UseGuards } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Observable, fromEvent, map, merge, timer } from 'rxjs';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@ApiTags('Bulk Upload SSE')
@Controller('api/bulk-upload')
export class BulkUploadSseController {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  @Sse(':uploadId/events')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Stream bulk upload events (SSE)' })
  streamEvents(
    @Param('uploadId') uploadId: string,
    @Query('type') uploadType: string = 'item',
  ): Observable<MessageEvent> {
    let eventName = `upload.${uploadId}`;
    if (uploadType === 'employee') {
      eventName = `employee-upload.${uploadId}`;
    } else if (uploadType === 'attendance') {
      eventName = `attendance-upload.${uploadId}`;
    }

    const events$ = fromEvent(this.eventEmitter, eventName).pipe(
      map((event: any) => ({ data: event } as MessageEvent)),
    );

    // Heartbeat every 20s — prevents Nginx/proxy from closing idle SSE connections
    const heartbeat$ = timer(15000, 20000).pipe(
      map(() => ({ data: { type: 'heartbeat', uploadId } } as MessageEvent)),
    );

    return merge(events$, heartbeat$);
  }
}
