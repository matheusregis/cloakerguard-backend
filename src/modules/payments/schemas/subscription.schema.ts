import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SubscriptionDocument = HydratedDocument<Subscription>;

@Schema({ timestamps: true })
export class Subscription {
  @Prop({ required: true, index: true }) userId!: string;
  @Prop({ required: true, index: true }) planId!: string;

  // novo: vínculo com o pagamento
  @Prop({ index: true }) paymentId?: string;

  @Prop({
    required: true,
    index: true,
    enum: ['active', 'past_due', 'canceled', 'expired'],
  })
  status!: 'active' | 'past_due' | 'canceled' | 'expired';

  @Prop({ required: true }) currentPeriodStart!: Date;
  @Prop({ required: true, index: true }) currentPeriodEnd!: Date;

  @Prop() cancelAt?: Date;
  @Prop() canceledAt?: Date;
  @Prop() providerCustomerId?: string;
}
export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);
SubscriptionSchema.index({ userId: 1, planId: 1, status: 1 });
