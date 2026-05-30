import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { loadEnvFile } from './load-env';
import { assertDatabaseEnv } from './config/validate-database-env';

loadEnvFile();
assertDatabaseEnv();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const requestLogger = new Logger('HTTP');

  app.enableCors({
    origin: configService.get<string[]>('cors.allowedOrigins'),
    credentials: true,
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const startedAt = Date.now();

    res.on('finish', () => {
      const duration = Date.now() - startedAt;
      const userAgent = req.get('user-agent') ?? '-';
      const ip =
        req.ip ||
        req.socket.remoteAddress ||
        (Array.isArray(req.headers['x-forwarded-for'])
          ? req.headers['x-forwarded-for'][0]
          : req.headers['x-forwarded-for']) ||
        '-';
      const message = `${req.method} ${req.originalUrl} ${res.statusCode} - ${duration}ms - ${ip} - ${userAgent}`;

      if (res.statusCode >= 500) {
        requestLogger.error(message);
      } else if (res.statusCode >= 400) {
        requestLogger.warn(message);
      } else {
        requestLogger.log(message);
      }
    });

    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Petunjukku API')
    .setDescription('Dokumentasi API backend Petunjukku')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Masukkan Supabase access token',
      },
      'supabase',
    )
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  const port = Number(process.env.APP_PORT) || 3001;
  await app.listen(port);
  console.log(`API berjalan di http://localhost:${port}`);
  console.log(`Swagger docs di http://localhost:${port}/docs`);
}
bootstrap();
