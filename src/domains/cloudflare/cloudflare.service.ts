// src/cloudflare/cloudflare.service.ts
import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { get as pslGet } from 'psl';

export type DnsType = 'A' | 'CNAME' | 'AAAA' | 'TXT';

export interface CloudflareDNSResult {
  id: string;
  zone_id: string;
  zone_name: string;
  name: string;
  type: DnsType;
  content: string;
  proxiable: boolean;
  proxied: boolean;
  ttl: number;
  [key: string]: any;
}

export interface CloudflareZone {
  id: string;
  name: string;
  status: string;
  [key: string]: any;
}

export interface CloudflareListResponse<T> {
  result: T[];
  success: boolean;
  errors: any[];
  messages: string[];
  result_info?: {
    page?: number;
    per_page?: number;
    total_count?: number;
  };
}

export interface CloudflareSingleResponse<T> {
  result: T;
  success: boolean;
  errors: any[];
  messages: string[];
}

/** Custom Hostnames (SaaS) */
export type CfValidationRecord = {
  http_url?: string;
  http_body?: string;
  txt_name?: string;
  txt_value?: string;
};

export type CfCustomHostname = {
  id: string;
  hostname: string;
  ssl?: {
    status?: string; // pending_validation | pending_issuance | active | ...
    validation_records?: CfValidationRecord[];
    method?: 'http' | 'txt' | 'email';
    type?: 'dv';
  };
  status?: string;
  created_at?: string;
  [key: string]: any;
};

@Injectable()
export class CloudflareService {
  private readonly logger = new Logger(CloudflareService.name);
  private readonly api: AxiosInstance;

  /** Zona SaaS (ex.: cloakerguard.com.br) onde os Custom Hostnames são criados */
  private readonly saasZoneId: string | undefined =
    process.env.CLOUDFLARE_ZONE_ID || process.env.CLOUDFLARE_SAAS_ZONE_ID;
  private readonly saasZoneName: string | undefined =
    process.env.CLOUDFLARE_ZONE_NAME;

  /** Cache opcional de zoneId por apex */
  private readonly zoneCache = new Map<string, string>();

  constructor() {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!token) this.logger.warn('CLOUDFLARE_API_TOKEN não definido.');

    this.api = axios.create({
      baseURL: 'https://api.cloudflare.com/client/v4',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    if (this.saasZoneId && this.saasZoneName) {
      this.zoneCache.set(this.saasZoneName, this.saasZoneId);
    }
  }

  // -------------------- utils/zones --------------------

  private getApexFromFqdn(fqdn: string): string | null {
    return (pslGet as (d: string) => string | null)(fqdn) ?? null;
  }

  private ensureExact<T>(arr: T[], predicate: (t: T) => boolean): T | null {
    return arr.find(predicate) ?? null;
  }

  async listZones(): Promise<CloudflareZone[]> {
    const res = await this.api.get<CloudflareListResponse<CloudflareZone>>(
      '/zones',
      { params: { per_page: 50 } },
    );
    return res.data.result ?? [];
  }

  async getZoneIdByApex(apex: string): Promise<string | null> {
    if (!apex) return null;
    if (this.zoneCache.has(apex)) return this.zoneCache.get(apex)!;

    const res = await this.api.get<CloudflareListResponse<CloudflareZone>>(
      '/zones',
      { params: { name: apex, status: 'active', per_page: 1 } },
    );

    const zone = res.data.result?.[0] ?? null;
    const zoneId = zone?.id ?? null;
    if (zoneId) this.zoneCache.set(apex, zoneId);
    return zoneId;
  }

  /** Resolve zoneId para operações de DNS dentro da ZONA dona do FQDN. */
  private async resolveZoneIdForName(
    fqdn: string,
    opts?: { zoneId?: string },
  ): Promise<string | null> {
    if (opts?.zoneId) return opts.zoneId;
    const apex = this.getApexFromFqdn(fqdn);
    if (!apex) return null;
    return this.getZoneIdByApex(apex);
  }

  // -------------------- DNS Records --------------------

  async createDNSRecord(
    name: string,
    type: DnsType,
    content: string,
    opts?: { zoneId?: string; proxied?: boolean; ttl?: number },
  ): Promise<CloudflareDNSResult> {
    try {
      const zoneId = await this.resolveZoneIdForName(name, opts);
      if (!zoneId) throw new Error('zoneId não resolvido para criar DNS');

      const res = await this.api.post<
        CloudflareSingleResponse<CloudflareDNSResult>
      >(`/zones/${zoneId}/dns_records`, {
        type,
        name,
        content,
        ttl: opts?.ttl ?? 120,
        proxied: opts?.proxied ?? false,
      });
      return res.data.result;
    } catch (err: any) {
      this.logger.error(
        `Erro ao criar DNS (${name}):`,
        err?.response?.data ? JSON.stringify(err.response.data) : err?.message,
      );
      throw err;
    }
  }

  async getDNSRecordId(
    name: string,
    opts: { zoneId?: string; type?: DnsType } = {},
  ): Promise<{ id: string; zoneId: string } | null> {
    try {
      const zoneId = await this.resolveZoneIdForName(name, opts);
      if (!zoneId) return null;

      const res = await this.api.get<
        CloudflareListResponse<CloudflareDNSResult>
      >(`/zones/${zoneId}/dns_records`, {
        params: {
          name,
          ...(opts.type ? { type: opts.type } : {}),
          per_page: 100,
          match: 'all',
        },
      });

      const record = this.ensureExact(
        res.data.result ?? [],
        (r) => r.name === name,
      );
      if (!record) return null;
      return { id: record.id, zoneId };
    } catch (err: any) {
      this.logger.error(
        `Erro ao buscar DNS ID (${name}):`,
        err?.response?.data ? JSON.stringify(err.response.data) : err?.message,
      );
      return null;
    }
  }

  async updateDNSRecordById(
    zoneId: string,
    id: string,
    data: {
      type: DnsType;
      content: string;
      name?: string;
      proxied?: boolean;
      ttl?: number;
    },
  ): Promise<CloudflareDNSResult> {
    try {
      const res = await this.api.put<
        CloudflareSingleResponse<CloudflareDNSResult>
      >(`/zones/${zoneId}/dns_records/${id}`, {
        type: data.type,
        name: data.name,
        content: data.content,
        proxied: data.proxied ?? false,
        ttl: data.ttl ?? 120,
      });
      return res.data.result;
    } catch (err: any) {
      this.logger.error(
        `Erro ao atualizar DNS (id=${id}):`,
        err?.response?.data ? JSON.stringify(err.response.data) : err?.message,
      );
      throw err;
    }
  }

  async deleteDNSRecordById(zoneId: string, id: string): Promise<void> {
    try {
      await this.api.delete<CloudflareSingleResponse<CloudflareDNSResult>>(
        `/zones/${zoneId}/dns_records/${id}`,
      );
    } catch (err: any) {
      this.logger.error(
        `Erro ao deletar DNS (id=${id}):`,
        err?.response?.data ? JSON.stringify(err.response.data) : err?.message,
      );
      throw err;
    }
  }

  async updateDNSByName(
    name: string,
    data: { type: DnsType; content: string; proxied?: boolean; ttl?: number },
    opts?: { zoneId?: string },
  ): Promise<CloudflareDNSResult> {
    const found = await this.getDNSRecordId(name, {
      zoneId: opts?.zoneId,
      type: data.type,
    });
    if (!found) throw new Error('Registro DNS não encontrado para este nome.');
    return this.updateDNSRecordById(found.zoneId, found.id, { name, ...data });
  }

  async deleteDNSByName(
    name: string,
    opts?: { zoneId?: string; type?: DnsType },
  ): Promise<void> {
    const found = await this.getDNSRecordId(name, {
      zoneId: opts?.zoneId,
      type: opts?.type,
    });
    if (!found) return;
    await this.deleteDNSRecordById(found.zoneId, found.id);
  }

  // -------------------- Custom Hostnames (SaaS) --------------------

  /** Cria Custom Hostname com validação HTTP (se você realmente precisar) */
  async createCustomHostnameHTTP(
    hostname: string,
    opts?: { origin?: string; zoneId?: string },
  ): Promise<CfCustomHostname> {
    const zoneId = opts?.zoneId || this.saasZoneId;
    if (!zoneId)
      throw new Error('CLOUDFLARE_ZONE_ID (zona SaaS) não configurado');

    const body: any = { hostname, ssl: { method: 'http', type: 'dv' } };
    if (opts?.origin) body.custom_origin_server = opts.origin;

    const res = await this.api.post<CloudflareSingleResponse<CfCustomHostname>>(
      `/zones/${zoneId}/custom_hostnames`,
      body,
    );
    return res.data.result;
  }

  /** Cria Custom Hostname com validação TXT (recomendado) */
  async createCustomHostnameTXT(
    hostname: string,
    opts?: { origin?: string; zoneId?: string },
  ): Promise<CfCustomHostname> {
    const zoneId = opts?.zoneId || this.saasZoneId;
    if (!zoneId)
      throw new Error('CLOUDFLARE_ZONE_ID (zona SaaS) não configurado');

    const body: any = {
      hostname,
      ssl: {
        method: 'txt',
        type: 'dv',
      },
    };

    if (opts?.origin) body.custom_origin_server = opts.origin;

    const res = await this.api.post<CloudflareSingleResponse<CfCustomHostname>>(
      `/zones/${zoneId}/custom_hostnames`,
      body,
    );
    return res.data.result;
  }

  async getCustomHostnameById(
    id: string,
    zoneId?: string,
  ): Promise<CfCustomHostname> {
    const z = zoneId || this.saasZoneId;
    if (!z) throw new Error('CLOUDFLARE_ZONE_ID não configurado');
    const r = await this.api.get<CloudflareSingleResponse<CfCustomHostname>>(
      `/zones/${z}/custom_hostnames/${id}`,
    );
    return r.data.result;
  }

  async getCustomHostnameByName(
    hostname: string,
    zoneId?: string,
  ): Promise<CfCustomHostname | null> {
    const z = zoneId || this.saasZoneId;
    if (!z) throw new Error('CLOUDFLARE_ZONE_ID não configurado');

    const res = await this.api.get<CloudflareListResponse<CfCustomHostname>>(
      `/zones/${z}/custom_hostnames`,
      { params: { hostname } },
    );

    return res.data.result?.[0] ?? null;
  }

  async deleteCustomHostnameById(id: string, zoneId?: string): Promise<void> {
    const z = zoneId || this.saasZoneId;
    if (!z) throw new Error('CLOUDFLARE_ZONE_ID não configurado');
    await this.api.delete<CloudflareSingleResponse<CfCustomHostname>>(
      `/zones/${z}/custom_hostnames/${id}`,
    );
  }

  /** Força reemissão/validação do SSL (padrão = txt; pode escolher http) */
  async updateCustomHostnameSSL(
    id: string,
    zoneId?: string,
    method: 'txt' | 'http' = 'txt',
  ): Promise<CfCustomHostname> {
    const z = zoneId || this.saasZoneId;
    if (!z) throw new Error('CLOUDFLARE_ZONE_ID não configurado');

    const res = await this.api.patch<
      CloudflareSingleResponse<CfCustomHostname>
    >(`/zones/${z}/custom_hostnames/${id}`, {
      ssl: { method, type: 'dv' },
    });

    return res.data.result;
  }

  /** Lista simples (array) */
  async listCustomHostnames(
    page = 1,
    perPage = 50,
    zoneId?: string,
    search?: { hostname?: string; ssl_status?: string },
  ): Promise<CfCustomHostname[]> {
    const z = zoneId || this.saasZoneId;
    if (!z) throw new Error('CLOUDFLARE_ZONE_ID não configurado');

    const params: Record<string, any> = { page, per_page: perPage };
    if (search?.hostname) params.hostname = search.hostname;
    if (search?.ssl_status) params['ssl'] = search.ssl_status;

    const r = await this.api.get<CloudflareListResponse<CfCustomHostname>>(
      `/zones/${z}/custom_hostnames`,
      { params },
    );
    return r.data.result ?? [];
  }
}
