import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DomainDocument = HydratedDocument<Domain>;

export enum DomainStatus {
  PENDING = 'PENDING',
  PROPAGATING = 'PROPAGATING',
  ACTIVE = 'ACTIVE',
  ERROR = 'ERROR',
}

@Schema({ timestamps: true })
export class Domain {
  @Prop({ required: true }) name: string;

  @Prop({ required: true, enum: ['CNAME'], default: 'CNAME' }) type: 'CNAME';

  @Prop({ required: true }) content: string;

  @Prop({ required: true }) subdomain: string;

  @Prop() whiteUrl?: string;
  @Prop() blackUrl?: string;

  @Prop({ required: true }) userId: string;
  @Prop({ default: false }) proxied: boolean;

  @Prop({ enum: DomainStatus, default: DomainStatus.PENDING })
  status: DomainStatus;

  @Prop() lastReason?: string;
  @Prop() lastCheckedAt?: Date;
}

export const DomainSchema = SchemaFactory.createForClass(Domain);
export { DomainStatus as EDomainStatus };
