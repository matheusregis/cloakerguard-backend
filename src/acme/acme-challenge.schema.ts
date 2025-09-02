import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ collection: 'acme_challenges' })
export class AcmeChallenge {
  @Prop({ required: true, index: true }) host!: string; // promo.matheusregis.com.br
  @Prop({ required: true, index: true }) token!: string; // segmento da URL
  @Prop({ required: true }) body!: string; // resposta exata
  @Prop() cfId?: string; // id do custom hostname
  @Prop({
    type: Date,
    default: () => new Date(Date.now() + 1000 * 60 * 60 * 24 * 7),
  })
  expireAt!: Date; // TTL 7d
}
export type AcmeChallengeDocument = HydratedDocument<AcmeChallenge>;
export const AcmeChallengeSchema = SchemaFactory.createForClass(AcmeChallenge);
AcmeChallengeSchema.index({ host: 1, token: 1 }, { unique: true });
AcmeChallengeSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });
