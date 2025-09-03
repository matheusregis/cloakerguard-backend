import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Delete,
  Query,
  NotFoundException,
} from '@nestjs/common';
import { DomainService } from './domain.service';
import { CreateDNSRecordDto } from './dto/create-dns.dto';
import { UpdateDNSRecordDto } from './dto/update-dns.dto';
import { Domain, DomainDocument } from './schemas/domain.schema';

function normalizeHost(raw = ''): string {
  let h = raw.split(',')[0].trim().toLowerCase();
  h = h.replace(/:\d+$/, '');
  h = h.replace(/^\[([^[\]]+)\](:\d+)?$/, '[$1]');
  return h;
}

function ensureHttpUrl(raw?: string): string | null {
  if (!raw) return null;
  const hasScheme = /^https?:\/\//i.test(raw);
  return hasScheme ? raw : `https://${raw}`;
}

@Controller('domains')
export class DomainController {
  constructor(private readonly domainService: DomainService) {}

  @Get('resolve')
  async resolve(@Query('host') host?: string) {
    const h = normalizeHost(host || '');
    console.log('[DOMAINS/RESOLVE] Host recebido:', host, 'Normalizado:', h);

    if (!h) {
      console.warn('[DOMAINS/RESOLVE] Host vazio → 404');
      throw new NotFoundException('host query is required');
    }

    const domain =
      (await (this.domainService as any).findByHost?.(h)) ||
      (await (this.domainService as any).findByName?.(h)) ||
      (await this.domainService.findBySubdomain(h)) ||
      null;

    if (!domain) {
      console.warn('[DOMAINS/RESOLVE] Não encontrou domain para host:', h);
      throw new NotFoundException('Domain not found');
    }

    console.log('[DOMAINS/RESOLVE] Encontrado domain:', {
      id: (domain as any)._id,
      name: domain.name,
      subdomain: (domain as any).subdomain,
      whiteUrl: (domain as any).whiteUrl,
      blackUrl: (domain as any).blackUrl,
    });

    return {
      host: domain.host || domain.name || h,
      whiteOrigin: domain.whiteOrigin || domain.whiteUrl || null,
      blackOrigin: domain.blackOrigin || domain.blackUrl || null,
      rules: domain.rules || {},
    };
  }

  @Post(':clientId')
  async createDomain(
    @Param('clientId') clientId: string,
    @Body() body: CreateDNSRecordDto,
  ): Promise<Domain | null> {
    return this.domainService.createDomain(body, clientId);
  }

  // ⚠️ ALTERADO para não colidir com /resolve
  @Get('client/:clientId')
  async getClientDomains(
    @Param('clientId') clientId: string,
  ): Promise<Domain[]> {
    return this.domainService.findAllByUser(clientId);
  }

  @Get('subdomain/:subdomain')
  async getBySubdomain(
    @Param('subdomain') subdomain: string,
  ): Promise<Domain | null> {
    return this.domainService.findBySubdomain(subdomain);
  }

  @Put(':domainId')
  updateDomain(
    @Param('domainId') domainId: string,
    @Body() body: UpdateDNSRecordDto,
  ): Promise<DomainDocument> {
    return this.domainService.updateDomain(domainId, body);
  }

  @Delete(':domainId')
  deleteDomain(
    @Param('domainId') domainId: string,
  ): Promise<{ deleted: true }> {
    return this.domainService.deleteDomain(domainId);
  }

  @Get(':domainId/status')
  async getStatus(@Param('domainId') domainId: string) {
    return this.domainService.checkStatus(domainId);
  }

  @Get('acme-http')
  async acmeHttp(@Query('host') host: string) {
    const body = await this.domainService.getAcmeHttpBody(host);
    if (!body) throw new NotFoundException('No token');
    return { body };
  }
}
