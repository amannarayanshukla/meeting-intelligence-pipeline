import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '1mb' }); // Express defaults to 100 KB; the DTO allows 200_000 chars (a 60-minute transcript)
  app.enableShutdownHooks(); // ponytail: lets BullMQ finish in-flight jobs on SIGTERM (Render redeploys); stalled-job recovery covers the rest
  app.setGlobalPrefix('api');
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? '*' });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.listen(process.env.PORT ?? 3001);
}
await bootstrap();
