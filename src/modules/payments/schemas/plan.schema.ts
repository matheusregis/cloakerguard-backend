import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export type PlanDocument = HydratedDocument<Plan>;

@Schema({ timestamps: true })
export class Plan {
  // catálogo global de planos do produto (sem userId/paymentId)
  @Prop({ required: true, index: true }) code!: string; // "Iniciante" | "Profissional" | "Elite"
  @Prop({ required: true }) name!: string;

  @Prop({ required: true }) amount!: number; // centavos
  @Prop({ default: 'BRL' }) currency!: string;

  @Prop({ enum: ['month', 'year'], default: 'month' })
  interval!: 'month' | 'year';
  @Prop({ default: 1 }) intervalCount!: number;

  @Prop({ default: true }) active!: boolean;

  // LIMITES DO PLANO (null = ilimitado)
  @Prop({ type: Number, default: null }) monthlyClicksLimit?: number | null;
  @Prop({ type: Number, default: null }) activeDomainsLimit?: number | null;

  @Prop({ type: SchemaTypes.Mixed }) metadata?: any;
}
export const PlanSchema = SchemaFactory.createForClass(Plan);
PlanSchema.index({ code: 1 }, { unique: true });
