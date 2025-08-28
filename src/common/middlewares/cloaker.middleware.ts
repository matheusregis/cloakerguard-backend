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
      const hostHdr = (req.headers['x-forwarded-host'] as string) || req.headers.host || '';
      const host = normalizeHost(hostHdr);

      // 🔧 TENTA pelos dois campos (subdomain OU name)
      const domain =
        (await this.domainService.findByHost?.(host)) ||
        (await this.domainService.findBySubdomain(host)) ||
        null;

      if (!domain) return next();

      const xfwd = (req.headers['x-forwarded-for'] as string) || '';
      const ip = (xfwd.split(',')[0] || req.socket.remoteAddress || '').trim();

      const ua = (req.headers['user-agent'] as string) || '';
      const referer =
        (req.headers['referer'] as string) ||
        (req.headers['referrer'] as string) ||
        '';

      const isBot = /bot|crawl|slurp|spider|mediapartners|facebookexternalhit/i.test(ua);
      const decision: 'passed' | 'filtered' = isBot ? 'filtered' : 'passed';
      const reason: 'bot' | 'vpn' | 'geo' | 'asn' | 'ua' | 'manual' | 'unknown' =
        isBot ? 'bot' : 'unknown';

      const targetRaw = isBot ? (domain as any).whiteUrl : (domain as any).blackUrl;
      const redirectTo = safeUrl(targetRaw);

      // Sem URL configurada? Não redireciona.
      if (!redirectTo) return next();

      // Evita loop: se destino == host atual, segue request
      try {
        const destHost = normalizeHost(new URL(redirectTo).host);
        if (destHost === host) return next();
      } catch {
        return next();
      }

      void this.logService.create({
        subdomain: host,
        ip,
        userAgent: ua,
        referer,
        isBot,
        redirectedTo: redirectTo,
      });

      void this.analytics.recordHit({
        userId: (domain as any).userId,
        domainId: String((domain as any)._id),
        domainName: (domain as any).name,
        decision,
        reason,
        ip,
        ua,
        referer,
      });

      return res.redirect(redirectTo);
    } catch (err) {
      console.error('Erro no CloakerMiddleware:', (err as Error).message);
      return next();
    }
  }
}
