import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

const USERS = [
  ['alice@pulse.dev', 'Alice'],
  ['bob@pulse.dev', 'Bob'],
  ['carol@pulse.dev', 'Carol'],
  ['bot@pulse.dev', 'Pulse Bot'],
] as const;

async function main() {
  if (await prisma.user.count()) return console.log('Already seeded');

  const users = await Promise.all(
    USERS.map(async ([email, name]) =>
      prisma.user.create({
        data: {
          email,
          name,
          // The bot never logs in; the demo users share one public password.
          passwordHash: await bcrypt.hash(
            email.startsWith('bot') ? randomBytes(16).toString('hex') : 'Demo123!',
            10,
          ),
        },
      }),
    ),
  );
  const [alice, bob, carol, bot] = users;
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000);

  const general = await prisma.room.create({
    data: { name: 'general', members: { create: users.map((u) => ({ userId: u.id, lastReadAt: ago(120) })) } },
  });
  const random = await prisma.room.create({
    data: { name: 'random', members: { create: [alice, bob, carol].map((u) => ({ userId: u.id, lastReadAt: ago(120) })) } },
  });
  await prisma.room.create({
    data: { name: 'tech-talk', members: { create: { userId: carol.id } } },
  });

  await prisma.message.createMany({
    data: [
      { roomId: general.id, senderId: alice.id, content: 'Welcome to Pulse! This channel is live over WebSockets.', createdAt: ago(60) },
      { roomId: general.id, senderId: bob.id, content: 'Open a second tab as another user and watch messages arrive instantly.', createdAt: ago(58) },
      { roomId: general.id, senderId: carol.id, content: 'Typing indicators, presence dots and read receipts work too.', createdAt: ago(55) },
      { roomId: random.id, senderId: bob.id, content: 'Anyone up for coffee later?', createdAt: ago(30) },
      { roomId: random.id, senderId: alice.id, content: 'Always. 3pm?', createdAt: ago(28) },
    ],
  });
  console.log(`Seeded ${users.length} users and 3 channels (bot: ${bot.email})`);
}

await main().finally(() => prisma.$disconnect());
