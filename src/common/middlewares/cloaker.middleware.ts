import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DomainService } from '../../domains/domain.service';
import { CloakerLogService } from '../../logs/cloaker-log.service';
import { AnalyticsService } from '../../modules/analytics/analytics.service';

function normalizeHost(raw: string): string {
  let h = (raw || '').split(',')[0].trim().toLowerCase();
  h = h.replace(/:\d+$/, '');
  h = h.replace(/^\[([^[\]]+)\](:\d+)?$/, '[$1]');
  return h;
}

function safeUrl(url?: string | null): string | null {
  const v = (url || '').trim();
  if (!v) return null;
  return /^https?:\/\//i.test(v) ? v : `https://${v}`;
}

@Injectable()
export class CloakerMiddleware implements NestMiddleware {
  constructor(
    private readonly domainService: DomainService,
    private readonly logService: CloakerLogService,
    private readonly analytics: AnalyticsService,
  ) {}

  async use(req: Request, res: Response, next: NextFunction) {
    try {
      // PRIORIDADE: X-Forwarded-Host -> Host
      const hostHdr =
        (req.headers['x-forwarded-host'] as string) ||
        (req.headers.host as string) ||
        '';
      const host = normalizeHost(hostHdr);

      // Se for host interno, não intercepta
      if (
        host.endsWith('cloakerguard.com.br') ||
        host.endsWith('www.cloakerguard.com.br') ||
        host.startsWith('api.cloakerguard.com.br')
      ) {
        return next();
      }

      // Procura domínio na base
      const domain =
        (await (this.domainService as any).findByHost?.(host)) ||
        (await (this.domainService as any).findByName?.(host)) ||
        (await this.domainService.findBySubdomain(host)) ||
        null;

      if (!domain) {
        return res.status(404).json({
          error: 'Domain not managed',
          host,
        });
      }

      const xfwd = (req.headers['x-forwarded-for'] as string) || '';
      const ip = (xfwd.split(',')[0] || req.socket.remoteAddress || '').trim();
      const ua = (req.headers['user-agent'] as string) || '';
      const referer =
        (req.headers['referer'] as string) ||
        (req.headers['referrer'] as string) ||
        '';

      // Regra de bloqueio de user-agent
      const isBot =
        (domain?.rules?.uaBlock &&
          new RegExp(domain.rules.uaBlock, 'i').test(ua)) ||
        /bot|crawl|slurp|spider|mediapartners|facebookexternalhit|headlesschrome|curl/i.test(
          ua,
        );

      const decision: 'passed' | 'filtered' = isBot ? 'filtered' : 'passed';
      const reason:
        | 'bot'
        | 'vpn'
        | 'geo'
        | 'asn'
        | 'ua'
        | 'manual'
        | 'unknown' = isBot ? 'bot' : 'unknown';

      const targetRaw = isBot ? domain.whiteUrl : domain.blackUrl;
      const redirectTo = safeUrl(targetRaw);

      if (!redirectTo) {
        return res.status(404).json({
          error: 'No redirect URL configured',
          host,
          decision,
        });
      }

      // Previne loop (se redirect for pro mesmo host)
      try {
        const destHost = normalizeHost(new URL(redirectTo).host);
        if (destHost === host) {
          return res.status(409).json({
            error: 'Redirect loop detected',
            host,
            redirectTo,
          });
        }
      } catch {
        return res.status(400).json({
          error: 'Invalid redirect URL',
          redirectTo,
        });
      }

      // Logs e analytics (assíncronos)
      void this.logService.create({
        subdomain: host,
        ip,
        userAgent: ua,
        referer,
        isBot,
        redirectedTo: redirectTo,
      });

      void this.analytics.recordHit({
        userId: domain.userId,
        domainId: String(domain._id),
        domainName: domain.name || host,
        decision,
        reason,
        ip,
        ua,
        referer,
      });

      // Redireciona o usuário
      return res.redirect(302, redirectTo);
    } catch (err) {
      console.error('Erro no CloakerMiddleware:', (err as Error).message);
      return res.status(500).json({
        error: 'Internal cloaker error',
        message: (err as Error).message,
      });
    }
  }
}
