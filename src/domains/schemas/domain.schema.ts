// src/domains/schemas/domain.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum EDomainStatus {
  PENDING = 'PENDING',
  PROPAGATING = 'PROPAGATING',
  ACTIVE = 'ACTIVE',
  ERROR = 'ERROR',
}

export enum ECertStatus {
  NONE = 'NONE',
  PENDING = 'PENDING',
  DNS01_NEEDED = 'DNS01_NEEDED',
  READY = 'READY',
  FAILED = 'FAILED',
}

export type ValidationRecord = {
  txt_name?: string;
  txt_value?: string;
  http_url?: string;
  http_body?: string;
};

@Schema({ collection: 'domains', timestamps: true })
export class Domain {
  @Prop({ required: true }) name!: string; // FQDN externo (ex: promo.matheusregis.com.br)
  @Prop() type?: string; // tipo do DNS do cliente (ex: CNAME)
  @Prop() content?: string; // target esperado (ex: edge.cloakerguard.com.br)
  @Prop() whiteUrl?: string;
  @Prop() blackUrl?: string;
  @Prop({ default: false }) proxied?: boolean;

  @Prop() subdomain?: string; // aqui você estava salvando o próprio FQDN externo
  @Prop({ required: true }) userId!: string;

  @Prop({ type: String, enum: EDomainStatus, default: EDomainStatus.PENDING })
  status!: EDomainStatus;

  @Prop() lastReason?: string;
  @Prop() lastCheckedAt?: Date;

  // 🔽 NECESSÁRIO p/ integração com emissão de cert no Fly
  @Prop({ type: String, enum: ECertStatus, default: ECertStatus.NONE })
  certStatus!: ECertStatus;

  @Prop() flyCertClientStatus?: string; // espelha clientStatus do Fly (debug)
  @Prop() flyCertConfigured?: boolean; // espelha configured do Fly (debug)
  @Prop() acmeMethod?: 'HTTP01' | 'ALPN' | 'DNS01';

  // DNS-01 (quando o Fly pedir)
  @Prop() acmeDnsCnameName?: string; // _acme-challenge.host
  @Prop() acmeDnsCnameTarget?: string; // <token>.flydns.net

  // opcional: id do cert no Fly se quiser rastrear
  @Prop() flyCertificateId?: string;

  // legado útil p/ exibir instruções
  @Prop({
    type: [
      {
        txt_name: { type: String },
        txt_value: { type: String },
        http_url: { type: String },
        http_body: { type: String },
      },
    ],
    default: [],
  })
  validationRecords?: ValidationRecord[];

  @Prop({ default: Date.now }) createdAt?: Date;
}

export type DomainDocument = Document & Domain;
export const DomainSchema = SchemaFactory.createForClass(Domain);
