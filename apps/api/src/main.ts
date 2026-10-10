import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { setupApp } from './setup-app.js';

const app = await NestFactory.create<NestExpressApplication>(AppModule);
app.set('trust proxy', 1);
setupApp(app);
await app.listen(process.env.PORT ?? 3001);
