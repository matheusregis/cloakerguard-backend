import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export type PaymentDocument = HydratedDocument<Payment>;

@Schema({ timestamps: true })
export class Payment {
  @Prop({ index: true }) userId?: string;

  // vínculo com o catálogo de planos
  @Prop({ index: true }) planId?: string;
  @Prop({ index: true }) planCode?: string;

  @Prop({ required: true, unique: true, index: true })
  orderId!: string;

  @Prop() chargeId?: string;
  @Prop() transactionId?: string;

  @Prop({ default: 'pagarme' }) provider!: string;
  @Prop() method?: string;

  @Prop({ required: true }) amount!: number; // centavos
  @Prop({ default: 'BRL' }) currency!: string;
  @Prop() installments?: number;
  @Prop() brand?: string;
  @Prop() lastFour?: string;

  @Prop({ required: true, index: true }) status!: string; // pending/paid/failed/…
  @Prop() paidAt?: Date;

  @Prop({ type: SchemaTypes.Mixed }) raw?: any;
}
export const PaymentSchema = SchemaFactory.createForClass(Payment);
