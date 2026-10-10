import {
  applyDecorators,
  createParamDecorator,
  ExecutionContext,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import { AuthGuard } from './auth.guard.js';

/** Requires a valid access token. */
export const Auth = () => applyDecorators(UseGuards(AuthGuard), ApiBearerAuth());

/** The authenticated user's id. */
export const UserId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest().user.id,
);
