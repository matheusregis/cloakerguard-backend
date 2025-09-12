// src/domains/domain.controller.ts
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

@Controller('domains')
export class DomainController {
  constructor(private readonly domainService: DomainService) {}

  @Get('resolve')
  async resolve(@Query('host') host?: string) {
    const h = normalizeHost(host || '');
    if (!h) throw new NotFoundException('host query is required');

    const domain =
      (await (this.domainService as any).findByHost?.(h)) ||
      (await (this.domainService as any).findByName?.(h)) ||
      (await this.domainService.findBySubdomain(h)) ||
      null;

    if (!domain) throw new NotFoundException('Domain not found');

    return {
      id: String(domain._id),
      userId: domain.userId,
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
}
