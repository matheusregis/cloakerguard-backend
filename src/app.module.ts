import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { DatabaseService } from './database/database.service';
import { DomainModule } from './domains/domain.module';
import { CloudflareModule } from './domains/cloudflare/cloudflare.module';
import { CloakerMiddleware } from './common/middlewares/cloaker.middleware';
import { DashboardModule } from './dashboard/dashboard.module';
import { CloakerLogModule } from './logs/cloaker-log.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { PaymentsModule } from './modules/payments/payments.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRoot(
      process.env.MONGODB_URI || 'mongodb://localhost:27017/nest',
    ),
    AuthModule,
    UsersModule,
    DomainModule,
    CloudflareModule,
    DashboardModule,
    CloakerLogModule,
    AnalyticsModule,
    PaymentsModule,
  ],
  providers: [DatabaseService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CloakerMiddleware).forRoutes('*');
  }
}
