import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Access } from './schemas/access.schema';
import { Model } from 'mongoose';

@Injectable()
export class DashboardService {
  constructor(@InjectModel(Access.name) private accessModel: Model<Access>) {}

  async getOverview(userId: string) {
    const total = await this.accessModel.find({ userId });
    const clicks = total.reduce((sum, a) => sum + a.filtered + a.passed, 0);
    const filtered = total.reduce((sum, a) => sum + a.filtered, 0);
    const activeDomains = new Set(total.map((a) => a.domain)).size;
    const successRate = ((clicks - filtered) / clicks) * 100 || 0;

    return [
      {
        title: 'Total Clicks',
        value: clicks.toLocaleString(),
        change: '+12.3%',
        trend: 'up',
        icon: 'Users',
      },
      {
        title: 'Filtered Traffic',
        value: `${((filtered / clicks) * 100).toFixed(1)}%`,
        change: '+2.1%',
        trend: 'up',
        icon: 'Shield',
      },
      {
        title: 'Active Domains',
        value: activeDomains.toString(),
        change: '-1',
        trend: 'down',
        icon: 'Globe',
      },
      {
        title: 'Success Rate',
        value: `${successRate.toFixed(1)}%`,
        change: '+0.8%',
        trend: 'up',
        icon: 'Zap',
      },
    ];
  }

  async getRecentActivity(userId: string) {
    const last = await this.accessModel
      .find({ userId })
      .sort({ createdAt: -1 })
      .limit(10);

    return last.map((a) => ({
      domain: a.domain,
      filtered: a.filtered,
      passed: a.passed,
      status: a.status,
    }));
  }

  async getPlanUsage(userId: string) {
    const total = await this.accessModel.find({ userId });
    const clicks = total.reduce((sum, a) => sum + a.filtered + a.passed, 0);
    const domainCount = new Set(total.map((a) => a.domain)).size;

    return {
      monthlyClicks: { used: clicks, limit: 1_000_000 },
      activeDomains: { used: domainCount, limit: 50 },
      plan: 'Pro Plan',
      daysToReset: 14,
    };
  }
}
