// src/modules/analytics/analytics.module.ts
import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Hit, HitSchema } from './schemas/hit.schema';
import { DailyStats, DailyStatsSchema } from './schemas/daily-stats.schema';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';
import { PaymentsModule } from '../payments/payments.module';
import { DomainModule } from '../../domains/domain.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Hit.name, schema: HitSchema },
      { name: DailyStats.name, schema: DailyStatsSchema },
    ]),
    PaymentsModule,
    DomainModule,
  ],
  providers: [AnalyticsService],
  controllers: [AnalyticsController],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
