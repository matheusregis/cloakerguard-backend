import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { DomainService } from 'src/domains/domain.service';

@Controller()
export class AnalyticsController {
  constructor(
    private svc: AnalyticsService,
    private domains: DomainService,
  ) {}

  private getUserId(req: any): string {
    return String(req?.user?.sub || req?.user?.userId || req?.user?.id || '');
  }

  // ======= DASHBOARD (autenticado) =======
  @UseGuards(JwtAuthGuard)
  @Get('dashboard/summary')
  async summary(
    @Req() req: any,
    @Query('year') year?: string,
    @Query('month') month?: string,
  ) {
    const userId = this.getUserId(req);
    const now = new Date();
    const y = Number(year) || now.getUTCFullYear();
    const m = Number(month) || now.getUTCMonth() + 1;

    const totals = await this.svc.getMonthlyTotals(userId, y, m);
    const filteredPct = totals.total ? totals.filtered / totals.total : 0;
    const successRate = totals.total ? totals.passed / totals.total : 0;

    const activeDomainsCount = await this.domains.countActiveByUser(userId);
    const plan = await this.svc.getPlanUsage(userId);
    const planUsage = { ...plan, activeDomainsUsed: activeDomainsCount };

    return {
      totalClicks: totals.total,
      filteredPct,
      successRate,
      activeDomains: activeDomainsCount,
      planUsage,
    };
  }

  @UseGuards(JwtAuthGuard)
  @Get('dashboard/recent-activity')
  async recent(@Req() req: any, @Query('limit') limit?: string) {
    const userId = this.getUserId(req);
    return this.svc.getRecentActivity(userId, Number(limit) || 3);
  }

  @UseGuards(JwtAuthGuard)
  @Get('dashboard/domains')
  async myDomains(@Req() req: any) {
    const userId = this.getUserId(req);
    return this.domains.findAllByUser(userId);
  }

  // ======= ANALYTICS (sem JWT, chamado pelo Edge) =======
  @Post('analytics/hit')
  async registerHit(@Body() body: any) {
    const { userId, domainId, domainName, decision, reason, ip, ua, referer } =
      body;

    await this.svc.recordHit({
      userId,
      domainId,
      domainName,
      decision,
      reason,
      ip,
      ua,
      referer,
    });

    return { success: true };
  }
}
