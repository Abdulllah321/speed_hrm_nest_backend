import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ cors: true })
export class ActivityLogsGateway {
  @WebSocketServer() server: Server;

  emitActivityLog(payload: any) {
    this.server.emit('activity_log', payload);
  }
}
 