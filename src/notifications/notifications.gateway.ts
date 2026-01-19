import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ cors: true })
export class NotificationsGateway {
  @WebSocketServer() server: Server;

  emitToUser(userId: string, payload: any) {
    this.server.emit('notification', { userId, ...payload });
  }
}
