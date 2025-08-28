import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { DomainService } from 'src/domains/domain.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class AnalyticsController {
  constructor(
    private svc: AnalyticsService,
    private domains: DomainService, // 👈 injeta DomainService
  ) {}

  private getUserId(req: any): string {
    return String(req?.user?.sub || req?.user?.userId || req?.user?.id || '');
  }

  @Get('summary')
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

    // ✅ só conta domínios com status ACTIVE
    const activeDomainsCount = await this.domains.countActiveByUser(userId);

    // mantém demais infos do plano, mas força activeDomainsUsed
    const plan = await this.svc.getPlanUsage(userId, y, m);
    const planUsage = { ...plan, activeDomainsUsed: activeDomainsCount };

    return {
      totalClicks: totals.total,
      filteredPct,
      successRate,
      activeDomains: activeDomainsCount, // 👈 aqui também
      planUsage,
    };
  }

  @Get('recent-activity')
  async recent(@Req() req: any, @Query('limit') limit?: string) {
    const userId = this.getUserId(req);
    return this.svc.getRecentActivity(userId, Number(limit) || 3);
  }

  // 🔥 NOVO: lista domínios do usuário autenticado
  @Get('domains')
  async myDomains(@Req() req: any) {
    const userId = this.getUserId(req);
    return this.domains.findAllByUser(userId);
  }
}
