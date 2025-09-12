// src/domains/fly/fly.service.ts
import { Injectable } from '@nestjs/common';

type AddCertResp = {
  id?: string;
  hostname: string;
  configured?: boolean;
  clientStatus?: string;
  isAcmeHttpConfigured?: boolean;
  acmeAlpnConfigured?: boolean;
  acmeDnsConfigured?: boolean;
  dnsValidationHostname?: string | null;
  dnsValidationTarget?: string | null;
};

type CheckCertResp = {
  configured?: boolean;
  clientStatus?: string;
  isAcmeHttpConfigured?: boolean;
  acmeAlpnConfigured?: boolean;
  acmeDnsConfigured?: boolean;
  dnsValidationHostname?: string | null;
  dnsValidationTarget?: string | null;
};

@Injectable()
export class FlyCertificatesService {
  private readonly API = 'https://api.fly.io/graphql';
  private readonly TOKEN = process.env.FLY_API_TOKEN!; // defina no ambiente

  private async gql<T>(query: string, variables: any): Promise<T> {
    const r = await fetch(this.API, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.TOKEN}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    const j = await r.json();
    if (j.errors) {
      throw new Error(
        j.errors?.map((e: any) => e.message).join(' | ') || 'Fly GraphQL error',
      );
    }
    return j.data;
  }

  async addCertificate(
    appIdOrName: string,
    hostname: string,
  ): Promise<AddCertResp> {
    const q = `
      mutation CreateCert($appId: ID!, $hostname: String!) {
        addCertificate(appId: $appId, hostname: $hostname) {
          certificate {
            id
            hostname
            configured
            clientStatus
            isAcmeHttpConfigured
            acmeAlpnConfigured
            acmeDnsConfigured
            dnsValidationHostname
            dnsValidationTarget
          }
        }
      }
    `;
    const data = await this.gql<{
      addCertificate: { certificate: AddCertResp };
    }>(q, { appId: appIdOrName, hostname });
    return data.addCertificate.certificate;
  }

  async checkCertificate(
    appName: string,
    hostname: string,
  ): Promise<CheckCertResp> {
    const q = `
      query CheckCert($appName: String!, $hostname: String!) {
        app(name: $appName) {
          certificate(hostname: $hostname) {
            configured
            clientStatus
            isAcmeHttpConfigured
            acmeAlpnConfigured
            acmeDnsConfigured
            dnsValidationHostname
            dnsValidationTarget
          }
        }
      }
    `;
    const data = await this.gql<{ app: { certificate: CheckCertResp | null } }>(
      q,
      { appName, hostname },
    );
    if (!data.app?.certificate) {
      throw new Error('Certificate not found on Fly for this hostname');
    }
    return data.app.certificate;
  }
}
