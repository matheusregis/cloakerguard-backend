import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PaymentsController } from './payments.controller';
import { PagarmeService } from './pagarme.service';
import { PaymentsRealtime } from './payments.realtime';
import { PaymentsAppService } from './payments.app.service';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import { Plan, PlanSchema } from './schemas/plan.schema';
import {
  Subscription,
  SubscriptionSchema,
} from './schemas/subscription.schema';
import {
  WebhookEvent,
  WebhookEventSchema,
} from './schemas/webhook-event.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Plan.name, schema: PlanSchema },
      { name: Subscription.name, schema: SubscriptionSchema },
      { name: WebhookEvent.name, schema: WebhookEventSchema },
    ]),
  ],
  controllers: [PaymentsController],
  providers: [PagarmeService, PaymentsRealtime, PaymentsAppService],
  exports: [PaymentsAppService], // <- exporta o serviço
})
export class PaymentsModule {}
