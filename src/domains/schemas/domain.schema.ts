// src/domains/schemas/domain.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export enum EDomainStatus {
  PENDING = 'PENDING',
  PROPAGATING = 'PROPAGATING',
  ACTIVE = 'ACTIVE',
  ERROR = 'ERROR',
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
  @Prop() content?: string; // target esperado (ex: <label>.cloakerguard.com.br)
  @Prop() whiteUrl?: string;
  @Prop() blackUrl?: string;
  @Prop({ default: false }) proxied?: boolean;

  @Prop() subdomain?: string; // nosso subdomínio interno (ex: <label>.cloakerguard.com.br)
  @Prop({ required: true }) userId!: string;

  @Prop({ type: String, enum: EDomainStatus, default: EDomainStatus.PENDING })
  status!: EDomainStatus;

  @Prop() lastReason?: string;
  @Prop() lastCheckedAt?: Date;

  // 🔽 NECESSÁRIO p/ integração com Custom Hostnames
  @Prop() customHostnameId?: string;

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

export type DomainDocument = Domain & Document;
export const DomainSchema = SchemaFactory.createForClass(Domain);
