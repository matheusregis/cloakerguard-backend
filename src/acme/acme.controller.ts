// src/acme/acme.controller.ts
import { Controller, Get, Query, Res, Post, Body } from '@nestjs/common';
import { Response } from 'express';
import { AcmeService } from './acme.service';

@Controller()
export class AcmeController {
  constructor(private readonly svc: AcmeService) {}

  // chamado pelo EDGE:
  // GET /acme/http-token?host=&token=
  @Get('acme/http-token')
  async httpToken(
    @Query('host') host: string,
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    if (!host || !token) return res.status(400).end();
    const body = await this.svc.getBody(host.toLowerCase(), token);
    if (!body) return res.status(404).end();
    res.type('text/plain').send(body);
  }

  // para o painel/onboarding chamar e CRIAR o custom hostname automaticamente
  // POST /saas/custom-hostnames { "hostname": "promo.matheusregis.com.br" }
  @Post('saas/custom-hostnames')
  async create(@Body() body: { hostname: string; origin?: string }) {
    const h = String(body.hostname || '')
      .toLowerCase()
      .trim();
    if (!h) throw new Error('hostname required');
    return this.svc.createCustomerHostname(h, body.origin);
  }
}
