import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import type { User } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { LoginDto, RegisterDto } from './auth.dto.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register({ email, name, password }: RegisterDto) {
    const normalized = email.toLowerCase();
    if (await this.prisma.user.findUnique({ where: { email: normalized } })) {
      throw new ConflictException('Email already registered');
    }
    const user = await this.prisma.user.create({
      data: {
        email: normalized,
        name,
        passwordHash: await bcrypt.hash(password, 10),
      },
    });
    await this.joinGeneral(user.id);
    return this.session(user);
  }

  async login({ email, password }: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.session(user);
  }

  async refresh(refreshToken: string) {
    try {
      const { sub } = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.getOrThrow('JWT_REFRESH_SECRET'),
      });
      return this.session(
        await this.prisma.user.findUniqueOrThrow({ where: { id: sub } }),
      );
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  me(id: string) {
    return this.prisma.user
      .findUniqueOrThrow({ where: { id } })
      .then(({ passwordHash: _, ...user }) => user);
  }

  /** New users start in the public #general channel. */
  private async joinGeneral(userId: string) {
    const general = await this.prisma.room.findUnique({ where: { name: 'general' } });
    if (general) {
      await this.prisma.roomMember.create({ data: { roomId: general.id, userId } });
    }
  }

  private async session({ passwordHash: _, ...user }: User) {
    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(
        { sub: user.id },
        { secret: this.config.getOrThrow('JWT_ACCESS_SECRET'), expiresIn: '15m' },
      ),
      this.jwt.signAsync(
        { sub: user.id },
        { secret: this.config.getOrThrow('JWT_REFRESH_SECRET'), expiresIn: '7d' },
      ),
    ]);
    return { user, accessToken, refreshToken };
  }
}
