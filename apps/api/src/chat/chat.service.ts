import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

export const BOT_EMAIL = 'bot@pulse.dev';
const MAX_LENGTH = 2000;

const MESSAGE_INCLUDE = { sender: { select: { id: true, name: true } } } as const;

@Injectable()
export class ChatService {
  private botId?: string;

  constructor(private readonly prisma: PrismaService) {}

  async roomsFor(userId: string) {
    const memberships = await this.prisma.roomMember.findMany({
      where: { userId },
      include: {
        room: {
          include: {
            members: { include: { user: { select: { id: true, name: true } } } },
            messages: { orderBy: { createdAt: 'desc' }, take: 1, include: MESSAGE_INCLUDE },
          },
        },
      },
    });
    const rooms = await Promise.all(
      memberships.map(async ({ room, lastReadAt }) => ({
        id: room.id,
        name: room.name,
        isDirect: room.isDirect,
        members: room.members.map((m) => ({ ...m.user, lastReadAt: m.lastReadAt })),
        lastMessage: room.messages[0] ?? null,
        unread: await this.prisma.message.count({
          where: { roomId: room.id, createdAt: { gt: lastReadAt }, senderId: { not: userId } },
        }),
      })),
    );
    return rooms.sort(
      (a, b) =>
        +(b.lastMessage?.createdAt ?? 0) - +(a.lastMessage?.createdAt ?? 0),
    );
  }

  roomIds(userId: string) {
    return this.prisma.roomMember
      .findMany({ where: { userId }, select: { roomId: true } })
      .then((rows) => rows.map((r) => r.roomId));
  }

  publicRooms(userId: string) {
    return this.prisma.room.findMany({
      where: { isDirect: false, members: { none: { userId } } },
      select: { id: true, name: true, _count: { select: { members: true } } },
      orderBy: { name: 'asc' },
    });
  }

  async createRoom(userId: string, rawName: string) {
    const name = rawName.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '');
    if (name.length < 2) throw new BadRequestException('Channel name is too short');
    if (await this.prisma.room.findUnique({ where: { name } })) {
      throw new ConflictException('A channel with that name already exists');
    }
    return this.prisma.room.create({
      data: { name, members: { create: { userId } } },
    });
  }

  async joinRoom(userId: string, roomId: string) {
    const room = await this.prisma.room.findFirst({ where: { id: roomId, isDirect: false } });
    if (!room) throw new BadRequestException('Channel not found');
    await this.prisma.roomMember.upsert({
      where: { roomId_userId: { roomId, userId } },
      create: { roomId, userId },
      update: {},
    });
    return room;
  }

  async directRoom(userId: string, otherId: string) {
    if (userId === otherId) throw new BadRequestException('You cannot message yourself');
    if (!(await this.prisma.user.findUnique({ where: { id: otherId } }))) {
      throw new BadRequestException('User not found');
    }
    return (
      (await this.prisma.room.findFirst({
        where: {
          isDirect: true,
          AND: [{ members: { some: { userId } } }, { members: { some: { userId: otherId } } }],
        },
      })) ??
      this.prisma.room.create({
        data: { isDirect: true, members: { create: [{ userId }, { userId: otherId }] } },
      })
    );
  }

  async messages(userId: string, roomId: string, cursor?: string, limit = 30) {
    await this.assertMember(userId, roomId);
    const rows = await this.prisma.message.findMany({
      where: { roomId },
      include: MESSAGE_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    return { items: page.reverse(), nextCursor: hasMore ? page[0].id : null };
  }

  async send(userId: string, roomId: string, rawContent: string) {
    const content = String(rawContent ?? '').trim();
    if (!content || content.length > MAX_LENGTH) {
      throw new BadRequestException(`Message must be 1-${MAX_LENGTH} characters`);
    }
    await this.assertMember(userId, roomId);
    return this.prisma.message.create({
      data: { roomId, senderId: userId, content },
      include: MESSAGE_INCLUDE,
    });
  }

  async markRead(userId: string, roomId: string) {
    await this.assertMember(userId, roomId);
    const lastReadAt = new Date();
    await this.prisma.roomMember.update({
      where: { roomId_userId: { roomId, userId } },
      data: { lastReadAt },
    });
    return lastReadAt;
  }

  searchUsers(userId: string, q = '') {
    return this.prisma.user.findMany({
      where: { id: { not: userId }, name: { contains: q, mode: 'insensitive' } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
      take: 20,
    });
  }

  /** The id of the demo bot when `roomId` is a direct chat with it. */
  async botIn(roomId: string, senderId: string) {
    this.botId ??= (await this.prisma.user.findUnique({ where: { email: BOT_EMAIL } }))?.id;
    if (!this.botId || this.botId === senderId) return null;
    const isBotRoom = await this.prisma.room.count({
      where: { id: roomId, isDirect: true, members: { some: { userId: this.botId } } },
    });
    return isBotRoom ? this.botId : null;
  }

  private async assertMember(userId: string, roomId: string) {
    const member = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId } },
    });
    if (!member) throw new ForbiddenException('You are not a member of this room');
  }
}
