import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  app.useGlobalPipes(new ValidationPipe());

  app.enableCors({
    origin: 'http://localhost:8080',
    credentials: true,
  });
  await app.listen(process.env.PORT || 3000);
  logger.log(`🚀 Aplicação rodando na porta ${process.env.PORT || 3000}`);
}
void bootstrap();
