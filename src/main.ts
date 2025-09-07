import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { CloakerMiddleware } from './common/middlewares/cloaker.middleware';
import { DomainService } from './domains/domain.service';
import { CloakerLogService } from './logs/cloaker-log.service';
import { AnalyticsService } from './modules/analytics/analytics.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger('Bootstrap');
  app.useGlobalPipes(new ValidationPipe());

  const allowed = [
    'http://localhost:8080',
    'https://cloakerguard.com.br',
    'https://www.cloakerguard.com.br',
    'https://api.cloakerguard.com.br',
  ];

  app.enableCors({
    origin: (origin, cb) => cb(null, !origin || allowed.includes(origin)),
    credentials: true,
  });

  // aplica CloakerMiddleware como global
  const domainService = app.get(DomainService);
  const logService = app.get(CloakerLogService);
  const analytics = app.get(AnalyticsService);
  const cloaker = new CloakerMiddleware(domainService, logService, analytics);
  app.use(cloaker.use.bind(cloaker));

  app.use((req, _res, next) => {
    console.log(
      '[REQ]',
      req.method,
      req.originalUrl,
      'Host:',
      req.headers.host,
    );
    next();
  });

  await app.listen(process.env.PORT || 3000);
  logger.log(`🚀 Aplicação rodando na porta ${process.env.PORT || 3000}`);
}
void bootstrap();
