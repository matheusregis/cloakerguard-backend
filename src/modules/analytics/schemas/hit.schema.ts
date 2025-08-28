import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type HitDocument = HydratedDocument<Hit>;

@Schema({ timestamps: false, _id: true })
export class Hit {
  @Prop({ required: true }) userId: string;
  @Prop({ required: true }) domainId: string;
  @Prop({ required: true }) domainName: string; // ex: teste.promocao.com.br
  @Prop({ required: true, enum: ['passed', 'filtered'] }) decision:
    | 'passed'
    | 'filtered';
  @Prop({
    required: true,
    enum: ['bot', 'vpn', 'geo', 'asn', 'ua', 'manual', 'unknown'],
  })
  reason: 'bot' | 'vpn' | 'geo' | 'asn' | 'ua' | 'manual' | 'unknown';
  @Prop() campaignId?: string;

  @Prop() ip?: string;
  @Prop() ua?: string;
  @Prop() asn?: string;
  @Prop() country?: string;
  @Prop() city?: string;
  @Prop() referer?: string;

  @Prop({ required: true }) ts: Date; // Date.now()
  @Prop({ required: true }) y: number;
  @Prop({ required: true }) m: number; // 1-12
  @Prop({ required: true }) d: number; // 1-31
}

export const HitSchema = SchemaFactory.createForClass(Hit);
HitSchema.index({ userId: 1, ts: -1 });
HitSchema.index({ userId: 1, m: 1, y: 1 });
HitSchema.index({ userId: 1, domainId: 1, ts: -1 });
