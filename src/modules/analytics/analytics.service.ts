import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Hit, HitDocument } from './schemas/hit.schema';
import { DailyStats, DailyStatsDocument } from './schemas/daily-stats.schema';
import { PaymentsAppService } from '../payments/payments.app.service';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Hit.name) private hitModel: Model<HitDocument>,
    @InjectModel(DailyStats.name) private dsModel: Model<DailyStatsDocument>,
    private readonly paymentsApp: PaymentsAppService,
  ) {}

  async recordHit(input: {
    userId: string;
    domainId: string;
    domainName: string;
    decision: 'passed' | 'filtered';
    reason: 'bot' | 'vpn' | 'geo' | 'asn' | 'ua' | 'manual' | 'unknown';
    campaignId?: string;
    ip?: string;
    ua?: string;
    asn?: string;
    country?: string;
    city?: string;
    referer?: string;
    at?: Date;
  }) {
    const at = input.at ?? new Date();
    const y = at.getUTCFullYear();
    const m = at.getUTCMonth() + 1;
    const d = at.getUTCDate();

    await this.hitModel.create({ ...input, ts: at, y, m, d });

    await this.dsModel.updateOne(
      { userId: input.userId, domainId: input.domainId, y, m, d },
      {
        $setOnInsert: { domainName: input.domainName },
        $set: { lastHitAt: at },
        $inc: { [input.decision]: 1 },
      },
      { upsert: true },
    );
  }

  // ====== Dashboard ======
  async getMonthlyTotals(userId: string, year: number, month: number) {
    const [row] = await this.dsModel.aggregate([
      { $match: { userId, y: year, m: month } },
      {
        $group: {
          _id: null,
          passed: { $sum: '$passed' },
          filtered: { $sum: '$filtered' },
        },
      },
      {
        $project: {
          _id: 0,
          passed: 1,
          filtered: 1,
          total: { $add: ['$passed', '$filtered'] },
        },
      },
    ]);
    return row ?? { passed: 0, filtered: 0, total: 0 };
  }

  async getActiveDomainsCount(userId: string, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const ids = await this.dsModel.distinct('domainId', {
      userId,
      lastHitAt: { $gte: since },
    });
    return ids.length;
  }

  async getRecentActivity(userId: string, limit = 3) {
    return this.dsModel.aggregate([
      { $match: { userId } },
      { $sort: { lastHitAt: -1 } },
      {
        $group: {
          _id: '$domainId',
          domainName: { $first: '$domainName' },
          lastHitAt: { $first: '$lastHitAt' },
          passed: { $sum: '$passed' },
          filtered: { $sum: '$filtered' },
        },
      },
      { $sort: { lastHitAt: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          domainId: '$_id',
          domainName: 1,
          lastHitAt: 1,
          passed: 1,
          filtered: 1,
          status: {
            $cond: [
              {
                $gt: [
                  '$lastHitAt',
                  new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
                ],
              },
              'active',
              'paused',
            ],
          },
        },
      },
    ]);
  }

  // Limites e ciclo vêm do módulo de pagamentos
  async getPlanUsage(userId: string, year: number, month: number) {
    const totals = await this.getMonthlyTotals(userId, year, month);
    const sub = await this.paymentsApp.getActiveSubscriptionSummary(userId);

    return {
      monthlyClicksUsed: totals.total,
      monthlyClicksLimit: sub?.limits?.monthlyClicksLimit ?? 0,
      activeDomainsUsed: await this.getActiveDomainsCount(userId),
      activeDomainsLimit: sub?.limits?.activeDomainsLimit ?? 0,
      cycleEndsAt: sub?.period_end ?? null,
    };
  }
}
