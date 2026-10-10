import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ChatService } from './chat.service.js';

describe('ChatService.send', () => {
  const prisma = {
    roomMember: { findUnique: vi.fn() },
    message: { create: vi.fn() },
  };
  const service = new ChatService(prisma as never);

  it('rejects empty and oversized messages', async () => {
    await expect(service.send('u1', 'r1', '   ')).rejects.toThrow(BadRequestException);
    await expect(service.send('u1', 'r1', 'x'.repeat(2001))).rejects.toThrow(BadRequestException);
  });

  it('rejects non-members', async () => {
    prisma.roomMember.findUnique.mockResolvedValue(null);
    await expect(service.send('u1', 'r1', 'hi')).rejects.toThrow(ForbiddenException);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it('trims content for members', async () => {
    prisma.roomMember.findUnique.mockResolvedValue({});
    prisma.message.create.mockResolvedValue({ id: 'm1' });
    await service.send('u1', 'r1', '  hello  ');
    expect(prisma.message.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: { roomId: 'r1', senderId: 'u1', content: 'hello' } }),
    );
  });
});
