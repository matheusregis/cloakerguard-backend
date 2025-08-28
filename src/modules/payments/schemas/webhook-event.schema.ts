import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';

export type WebhookEventDocument = HydratedDocument<WebhookEvent>;

@Schema()
export class WebhookEvent {
  @Prop({ index: true }) orderId?: string;
  @Prop({ index: true }) userId?: string; // importante pra rastrear dono
  @Prop() type?: string;
  @Prop() status?: string;
  @Prop({ type: SchemaTypes.Mixed }) payload!: any;
  @Prop({ default: () => new Date() }) receivedAt!: Date;
}
export const WebhookEventSchema = SchemaFactory.createForClass(WebhookEvent);
