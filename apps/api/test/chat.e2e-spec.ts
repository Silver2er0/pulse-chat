import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { setupApp } from '../src/setup-app.js';

const once = <T>(socket: Socket, event: string) =>
  new Promise<T>((resolve) => socket.once(event, resolve));

describe('Chat (e2e)', () => {
  const stamp = Date.now();
  const sockets: Socket[] = [];
  let app: INestApplication;
  let prisma: PrismaService;
  let http: ReturnType<typeof request>;
  let url: string;

  const signup = async (name: string) => {
    const { body } = await http
      .post('/auth/register')
      .send({ email: `${name}-${stamp}@test.dev`, name, password: 'password123' })
      .expect(201);
    return { token: body.accessToken as string, id: body.user.id as string };
  };
  const connect = async (token: string) => {
    const socket = io(url, { auth: { token }, transports: ['websocket'] });
    sockets.push(socket);
    await once(socket, 'presence:list');
    return socket;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.listen(0);
    url = `http://localhost:${(app.getHttpServer().address() as { port: number }).port}`;
    prisma = app.get(PrismaService);
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await prisma.room.deleteMany({ where: { name: `e2e-${stamp}` } });
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${stamp}@test.dev` } } });
    await app.close();
  });

  it('delivers messages, typing and presence in real time', async () => {
    const alice = await signup('alice');
    const bob = await signup('bob');
    const eve = await signup('eve');

    const bobSocket = await connect(bob.token);
    const aliceSocket = await connect(alice.token);
    const eveSocket = await connect(eve.token);

    // Rejects sockets with a bad token.
    const bad = io(url, { auth: { token: 'nope' }, transports: ['websocket'] });
    sockets.push(bad);
    await once(bad, 'auth:error');

    const { body: room } = await http
      .post('/rooms')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ name: `e2e-${stamp}` })
      .expect(201);
    await http.post(`/rooms/${room.id}/join`).set('Authorization', `Bearer ${bob.token}`).expect(201);

    // Bob's already-open socket receives the room's events right after joining.
    const received = once<{ content: string; clientId: string; sender: { name: string } }>(bobSocket, 'message:new');
    const ack = await aliceSocket.emitWithAck('message:send', { roomId: room.id, content: 'hello bob', clientId: 'c1' });
    expect(ack.ok).toBe(true);
    expect(await received).toMatchObject({ content: 'hello bob', clientId: 'c1', sender: { name: 'alice' } });

    const typing = once(aliceSocket, 'typing');
    bobSocket.emit('typing', { roomId: room.id, typing: true });
    expect(await typing).toEqual({ roomId: room.id, userId: bob.id, typing: true });

    // A non-member can neither send nor read history.
    expect(await eveSocket.emitWithAck('message:send', { roomId: room.id, content: 'intruder' })).toMatchObject({ ok: false });
    await http.get(`/rooms/${room.id}/messages`).set('Authorization', `Bearer ${eve.token}`).expect(403);

    // Bob marks the room as read; Alice sees the receipt.
    const read = once(aliceSocket, 'room:read');
    await bobSocket.emitWithAck('message:read', { roomId: room.id });
    expect(await read).toMatchObject({ roomId: room.id, userId: bob.id });

    const { body: history } = await http
      .get(`/rooms/${room.id}/messages`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(history.items.map((m: { content: string }) => m.content)).toEqual(['hello bob']);

    const offline = once(aliceSocket, 'presence');
    bobSocket.close();
    expect(await offline).toEqual({ userId: bob.id, online: false });
  });
});
