import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Request as ExpressRequest } from 'express';

interface RequestWithUser extends ExpressRequest {
  user: { sub: string; email: string; name: string };
}

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('overview')
  getOverview(@Req() req: RequestWithUser) {
    const userId = req.user?.sub;
    return this.dashboardService.getOverview(userId);
  }

  @Get('activity')
  getRecentActivity(@Req() req: RequestWithUser) {
    const userId = req.user?.sub;
    return this.dashboardService.getRecentActivity(userId);
  }

  @Get('usage')
  getPlanUsage(@Req() req: RequestWithUser) {
    const userId = req.user?.sub;
    return this.dashboardService.getPlanUsage(userId);
  }
}
