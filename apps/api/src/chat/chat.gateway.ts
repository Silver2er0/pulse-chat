import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Server, Socket } from 'socket.io';
import { ChatService } from './chat.service.js';

interface SendPayload {
  roomId: string;
  content: string;
  clientId?: string;
}

const BOT_REPLIES: [RegExp, string][] = [
  [/\b(hi|hello|hey)\b/i, 'Hey! I am Pulse Bot. Open this app in a second tab as another user to chat in real time.'],
  [/\b(how|what).*(work|built|made)\b/i, 'Messages travel over a Socket.IO WebSocket to a NestJS gateway, get stored in Postgres, then fan out to everyone in the room.'],
  [/\bthank/i, 'Any time!'],
];

@WebSocketGateway({
  cors: { origin: process.env.WEB_URL?.split(',') ?? true },
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  /** userId -> number of open sockets (a user can have several tabs). */
  private readonly online = new Map<string, number>();

  constructor(
    private readonly chat: ChatService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async handleConnection(socket: Socket) {
    let userId: string;
    try {
      const { sub } = await this.jwt.verifyAsync(socket.handshake.auth?.token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      });
      userId = sub;
    } catch {
      socket.emit('auth:error');
      socket.disconnect(true);
      return;
    }

    socket.data.userId = userId;
    const roomIds = await this.chat.roomIds(userId);
    await socket.join([`user:${userId}`, ...roomIds.map((id) => `room:${id}`)]);

    const count = this.online.get(userId) ?? 0;
    this.online.set(userId, count + 1);
    if (!count) this.server.emit('presence', { userId, online: true });
    socket.emit('presence:list', [...this.online.keys()]);
  }

  handleDisconnect(socket: Socket) {
    const userId: string | undefined = socket.data.userId;
    if (!userId) return;
    const count = (this.online.get(userId) ?? 1) - 1;
    if (count > 0) return void this.online.set(userId, count);
    this.online.delete(userId);
    this.server.emit('presence', { userId, online: false });
  }

  @SubscribeMessage('message:send')
  async onSend(@ConnectedSocket() socket: Socket, @MessageBody() { roomId, content, clientId }: SendPayload) {
    try {
      const message = await this.chat.send(socket.data.userId, roomId, content);
      this.server.to(`room:${roomId}`).emit('message:new', { ...message, clientId });
      void this.maybeBotReply(roomId, socket.data.userId, message.content);
      return { ok: true, id: message.id };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  @SubscribeMessage('typing')
  onTyping(@ConnectedSocket() socket: Socket, @MessageBody() { roomId, typing }: { roomId: string; typing: boolean }) {
    // Rooms the socket joined on connect double as a cheap membership check.
    if (!socket.rooms.has(`room:${roomId}`)) return;
    socket.to(`room:${roomId}`).emit('typing', { roomId, userId: socket.data.userId, typing: !!typing });
  }

  @SubscribeMessage('message:read')
  async onRead(@ConnectedSocket() socket: Socket, @MessageBody() { roomId }: { roomId: string }) {
    try {
      const at = await this.chat.markRead(socket.data.userId, roomId);
      this.server.to(`room:${roomId}`).emit('room:read', { roomId, userId: socket.data.userId, at });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  /** Called after a REST join/create so the user's open sockets receive the room's events. */
  async addToRoom(userIds: string[], roomId: string) {
    for (const id of userIds) {
      this.server.in(`user:${id}`).socketsJoin(`room:${roomId}`);
      this.server.to(`user:${id}`).emit('room:new', { roomId });
    }
  }

  private async maybeBotReply(roomId: string, senderId: string, text: string) {
    const botId = await this.chat.botIn(roomId, senderId);
    if (!botId) return;
    const room = `room:${roomId}`;
    const reply =
      BOT_REPLIES.find(([pattern]) => pattern.test(text))?.[1] ??
      `You said: "${text.slice(0, 80)}". Try saying hello or asking how I was built.`;

    this.server.to(room).emit('typing', { roomId, userId: botId, typing: true });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const message = await this.chat.send(botId, roomId, reply);
    this.server.to(room).emit('typing', { roomId, userId: botId, typing: false });
    this.server.to(room).emit('message:new', message);
  }
}
