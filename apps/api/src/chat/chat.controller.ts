import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import { Auth, UserId } from '../common/auth.decorator.js';
import { ChatGateway } from './chat.gateway.js';
import { ChatService } from './chat.service.js';

class CreateRoomDto {
  @IsString() @MinLength(2) name: string;
}

class DirectRoomDto {
  @IsString() userId: string;
}

class MessagesQuery {
  @IsOptional() @IsString() cursor?: string;
}

@ApiTags('chat')
@Auth()
@Controller()
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly gateway: ChatGateway,
  ) {}

  @Get('rooms')
  rooms(@UserId() userId: string) {
    return this.chat.roomsFor(userId);
  }

  @Get('rooms/public')
  publicRooms(@UserId() userId: string) {
    return this.chat.publicRooms(userId);
  }

  @Post('rooms')
  async create(@UserId() userId: string, @Body() { name }: CreateRoomDto) {
    const room = await this.chat.createRoom(userId, name);
    await this.gateway.addToRoom([userId], room.id);
    return room;
  }

  @Post('rooms/direct')
  async direct(@UserId() userId: string, @Body() { userId: otherId }: DirectRoomDto) {
    const room = await this.chat.directRoom(userId, otherId);
    await this.gateway.addToRoom([userId, otherId], room.id);
    return room;
  }

  @Post('rooms/:id/join')
  async join(@UserId() userId: string, @Param('id') id: string) {
    const room = await this.chat.joinRoom(userId, id);
    await this.gateway.addToRoom([userId], id);
    return room;
  }

  @Get('rooms/:id/messages')
  messages(@UserId() userId: string, @Param('id') id: string, @Query() { cursor }: MessagesQuery) {
    return this.chat.messages(userId, id, cursor);
  }

  @Get('users')
  users(@UserId() userId: string, @Query('q') q?: string) {
    return this.chat.searchUsers(userId, q);
  }
}
