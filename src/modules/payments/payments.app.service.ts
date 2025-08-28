import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Payment, PaymentDocument } from './schemas/payment.schema';
import { Plan, PlanDocument } from './schemas/plan.schema';
import {
  Subscription,
  SubscriptionDocument,
} from './schemas/subscription.schema';
import {
  WebhookEvent,
  WebhookEventDocument,
} from './schemas/webhook-event.schema';

type Interval = 'month' | 'year';

const PLAN_PRESETS: Record<
  string,
  {
    amount?: number;
    monthlyClicksLimit?: number | null;
    activeDomainsLimit?: number | null;
  }
> = {
  Iniciante: {
    amount: 9700,
    monthlyClicksLimit: 50_000,
    activeDomainsLimit: 5,
  },
  Profissional: {
    amount: 29700,
    monthlyClicksLimit: 200_000,
    activeDomainsLimit: 20,
  },
  Elite: { amount: 59700, monthlyClicksLimit: null, activeDomainsLimit: null },
  Free: { amount: 0, monthlyClicksLimit: 5_000, activeDomainsLimit: 1 }, // fallback
};

@Injectable()
export class PaymentsAppService {
  private readonly logger = new Logger(PaymentsAppService.name);

  constructor(
    @InjectModel(Payment.name) private payments: Model<PaymentDocument>,
    @InjectModel(Plan.name) private plans: Model<PlanDocument>,
    @InjectModel(Subscription.name) private subs: Model<SubscriptionDocument>,
    @InjectModel(WebhookEvent.name) private events: Model<WebhookEventDocument>,
  ) {}

  private addPeriod(start: Date, interval: Interval, count = 1) {
    const d = new Date(start);
    if (interval === 'year') d.setFullYear(d.getFullYear() + count);
    else d.setMonth(d.getMonth() + count);
    return d;
  }

  // garante o plano de catálogo com limites
  async ensurePlan(code: string, viaAmount?: number) {
    const preset = PLAN_PRESETS[code] || {};
    const amount = viaAmount ?? preset.amount ?? 0;

    let plan = await this.plans.findOne({ code }).lean();
    if (!plan) {
      plan = (
        await this.plans.create({
          code,
          name: code,
          amount,
          currency: 'BRL',
          interval: 'month',
          intervalCount: 1,
          active: true,
          monthlyClicksLimit: preset.monthlyClicksLimit ?? null,
          activeDomainsLimit: preset.activeDomainsLimit ?? null,
        })
      ).toJSON();
    } else {
      // completa campos caso antigos não tenham limites
      const patch: any = {};
      if (plan.monthlyClicksLimit === undefined)
        patch.monthlyClicksLimit = preset.monthlyClicksLimit ?? null;
      if (plan.activeDomainsLimit === undefined)
        patch.activeDomainsLimit = preset.activeDomainsLimit ?? null;
      if (Object.keys(patch).length) {
        await this.plans.updateOne({ _id: plan._id }, { $set: patch });
        plan = await this.plans.findById(plan._id).lean();
      }
    }
    return plan;
  }

  async ensureFreePlan() {
    return this.ensurePlan('Free', 0);
  }

  async recordWebhook(
    orderId?: string,
    type?: string,
    status?: string,
    payload?: any,
    userId?: string,
  ) {
    try {
      await this.events.create({
        orderId,
        userId,
        type,
        status,
        payload,
        receivedAt: new Date(),
      });
    } catch (e) {
      this.logger.error(`recordWebhook failed (${orderId}): ${String(e)}`);
    }
  }

  // expira assinaturas vencidas
  private async expireIfNeeded(userId: string) {
    const now = new Date();
    await this.subs.updateMany(
      { userId, status: 'active', currentPeriodEnd: { $lte: now } },
      { $set: { status: 'expired', updatedAt: new Date() } },
    );
  }

  async upsertPaymentFromOrder(opts: {
    order: any;
    status: string;
    method?: string;
    planCode?: string;
    userId?: string;
  }) {
    const { order, status } = opts;
    const orderId = order?.id || order?.order_id;
    if (!orderId) return;

    const charge = order?.charges?.[0] || {};
    const tx = charge?.last_transaction || {};
    const card = tx?.card || {};
    const meta = order?.metadata || {};

    const userId = opts.userId || meta?.user_id || meta?.userId || undefined;
    const planCode = (opts.planCode ||
      order?.items?.[0]?.code ||
      meta?.plan ||
      meta?.plan_code ||
      'Free') as string;

    const plan = await this.ensurePlan(
      planCode,
      Number(order?.amount || charge?.amount || 0),
    );

    // upsert + retorna doc pra pegar _id (paymentId)
    const saved = await this.payments.findOneAndUpdate(
      { orderId },
      {
        $setOnInsert: { orderId, provider: 'pagarme', createdAt: new Date() },
        $set: {
          userId: userId || undefined,
          planId: plan?._id?.toString(),
          planCode,
          chargeId: charge?.id,
          transactionId: tx?.id,
          method: charge?.payment_method || tx?.transaction_type || opts.method,
          amount: Number(order?.amount || charge?.amount || tx?.amount || 0),
          currency: 'BRL',
          installments: tx?.installments || undefined,
          brand: card?.brand || undefined,
          lastFour: card?.last_four_digits || undefined,
          status,
          paidAt: status === 'paid' ? new Date() : undefined,
          raw: order,
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true, lean: true },
    );

    // cria/renova assinatura quando "paid"
    if (status === 'paid' && userId && plan?._id) {
      const now = new Date();
      const end = this.addPeriod(
        now,
        (plan.interval as Interval) || 'month',
        plan.intervalCount || 1,
      );

      const existing = await this.subs.findOne({
        userId: String(userId),
        planId: String(plan._id),
        status: 'active',
        currentPeriodEnd: { $gt: now },
      });

      if (existing) {
        const newEnd = this.addPeriod(
          existing.currentPeriodEnd,
          (plan.interval as Interval) || 'month',
          plan.intervalCount || 1,
        );
        await this.subs.updateOne(
          { _id: existing._id },
          {
            $set: {
              currentPeriodEnd: newEnd,
              updatedAt: new Date(),
              paymentId: saved?._id?.toString(),
            },
          },
        );
      } else {
        await this.subs.create({
          userId: String(userId),
          planId: String(plan._id),
          paymentId: saved?._id?.toString(),
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: end,
        });
      }
    }
  }

  // usado no dashboard/summary ou /payments/me/subscription
  async getActiveSubscriptionSummary(userId: string) {
    await this.expireIfNeeded(userId);

    const now = new Date();
    const sub = await this.subs
      .findOne({ userId, status: 'active', currentPeriodEnd: { $gt: now } })
      .lean();

    if (!sub) {
      const free = await this.ensureFreePlan();
      return {
        active: false,
        plan: free ? { code: free.code, name: free.name } : null,
        period_end: null as string | null,
        limits: {
          monthlyClicksLimit: free?.monthlyClicksLimit ?? null,
          activeDomainsLimit: free?.activeDomainsLimit ?? null,
        },
      };
    }

    const plan = await this.plans.findById(sub.planId).lean();
    return {
      active: true,
      plan: plan ? { code: plan.code, name: plan.name } : null,
      period_end: sub.currentPeriodEnd?.toISOString?.() ?? null,
      limits: {
        monthlyClicksLimit: plan?.monthlyClicksLimit ?? null,
        activeDomainsLimit: plan?.activeDomainsLimit ?? null,
      },
    };
  }
}
