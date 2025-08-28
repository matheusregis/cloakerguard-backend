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

@Injectable()
export class CloudflareService {
  private readonly logger = new Logger(CloudflareService.name);
  private readonly api: AxiosInstance;
  private readonly zoneCache = new Map<string, string>(); // apex -> zoneId

  constructor() {
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!token) {
      this.logger.warn('CLOUDFLARE_API_TOKEN não definido.');
    }

    this.api = axios.create({
      baseURL: 'https://api.cloudflare.com/client/v4',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });

    const defaultZoneId = process.env.CLOUDFLARE_ZONE_ID;
    const defaultApex = process.env.CLOUDFLARE_ZONE_NAME; // ex: "autochecking.com.br"
    if (defaultZoneId && defaultApex)
      this.zoneCache.set(defaultApex, defaultZoneId);
  }

  private getApexFromFqdn(fqdn: string): string | null {
    const apex = (pslGet as (domain: string) => string | null)(fqdn);
    return apex ?? null;
  }

  private ensureExact<T>(arr: T[], predicate: (t: T) => boolean): T | null {
    return arr.find(predicate) ?? null;
  }

  async listZones(): Promise<CloudflareZone[]> {
    const res = await this.api.get<CloudflareListResponse<CloudflareZone>>(
      '/zones',
      {
        params: { per_page: 50 },
      },
    );
    return res.data.result ?? [];
  }

  async getZoneIdByApex(apex: string): Promise<string | null> {
    if (!apex) return null;

    if (this.zoneCache.has(apex)) return this.zoneCache.get(apex)!;

    const res = await this.api.get<CloudflareListResponse<CloudflareZone>>(
      '/zones',
      {
        params: { name: apex, status: 'active', per_page: 1 },
      },
    );

    const zone = res.data.result?.[0] ?? null;
    const zoneId = zone?.id ?? null;

    if (zoneId) this.zoneCache.set(apex, zoneId);
    return zoneId;
  }

  /**
   * Resolve zoneId a partir de um FQDN (ex.: sub.apex.com.br -> apex.com.br -> zoneId)
   * Opcionalmente aceita um zoneId “forçado” via opts.
   */
  private async resolveZoneIdForName(
    fqdn: string,
    opts?: { zoneId?: string },
  ): Promise<string | null> {
    if (opts?.zoneId) return opts.zoneId;

    const apex = this.getApexFromFqdn(fqdn);
    if (!apex) return null;

    return this.getZoneIdByApex(apex);
  }

  // ---- DNS Records ----

  async createDNSRecord(
    name: string,
    type: DnsType,
    content: string,
    opts?: { zoneId?: string; proxied?: boolean; ttl?: number },
  ): Promise<CloudflareDNSResult> {
    try {
      const res = await this.api.post<
        CloudflareSingleResponse<CloudflareDNSResult>
      >(`/zones/${opts?.zoneId}/dns_records`, {
        type,
        name,
        content,
        ttl: opts?.ttl ?? 120,
        proxied: opts?.proxied ?? false,
      });
      return res.data.result;
    } catch (err: any) {
      this.logger.error(
        `Erro ao criar DNS na Cloudflare (${name}):`,
        err?.response?.data ? JSON.stringify(err.response.data) : err?.message,
      );
      throw err;
    }
  }

  /**
   * Retorna o ID do record exato (name + opcional type) dentro de uma zona.
   */
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

      const record =
        this.ensureExact(res.data.result ?? [], (r) => r.name === name) ?? null;

      if (!record) return null;
      return { id: record.id, zoneId };
    } catch (err: any) {
      this.logger.error(
        `Erro ao buscar DNS ID na Cloudflare (${name}):`,
        err?.response?.data ? JSON.stringify(err.response.data) : err?.message,
      );
      return null;
    }
  }

  /**
   * Atualiza um record pelo ID (exige zoneId).
   */
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
        `Erro ao atualizar DNS na Cloudflare (id=${id}):`,
        err?.response?.data ? JSON.stringify(err.response.data) : err?.message,
      );
      throw err;
    }
  }

  /**
   * Deleta um record pelo ID (exige zoneId).
   */
  async deleteDNSRecordById(zoneId: string, id: string): Promise<void> {
    try {
      await this.api.delete<CloudflareSingleResponse<CloudflareDNSResult>>(
        `/zones/${zoneId}/dns_records/${id}`,
      );
    } catch (err: any) {
      this.logger.error(
        `Erro ao deletar DNS na Cloudflare (id=${id}):`,
        err?.response?.data ? JSON.stringify(err.response.data) : err?.message,
      );
      throw err;
    }
  }

  /**
   * Atualiza um record pelo FQDN (resolve zoneId e recordId).
   */
  async updateDNSByName(
    name: string,
    data: { type: DnsType; content: string; proxied?: boolean; ttl?: number },
    opts?: { zoneId?: string },
  ): Promise<CloudflareDNSResult> {
    const found = await this.getDNSRecordId(name, {
      zoneId: opts?.zoneId,
      type: data.type,
    });
    if (!found)
      throw new Error(
        'Registro DNS não encontrado na Cloudflare para este nome.',
      );
    return this.updateDNSRecordById(found.zoneId, found.id, { name, ...data });
  }

  /**
   * Deleta um record pelo FQDN.
   */
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
}
