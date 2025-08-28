// src/modules/payments/payments.controller.ts
import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Sse,
  MessageEvent as SseMessageEvent,
  Req,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { PagarmeService } from './pagarme.service';
import { PaymentsRealtime } from './payments.realtime';
import { PaymentsAppService } from './payments.app.service';

type FrontAddress = {
  street: string;
  number: string;
  complement?: string;
  neighborhood?: string;
  zip_code: string;
  city: string;
  state: string;
  country: string;
};

type ChargeBody = {
  amount: number;
  card_token?: string;
  installments: number;
  description?: string;
  metadata?: Record<string, any>;
  billingAddress: FrontAddress;
  customer: {
    name: string;
    email: string;
    document: string;
    phone?: string;
    address?: FrontAddress;
  };
  cardRaw?: {
    number: string;
    holder_name: string;
    exp_month: string;
    exp_year: string;
    cvv: string;
  };
  cardBillingAddress?: FrontAddress;
};

type PixBody = {
  amount: number;
  description?: string;
  metadata?: Record<string, any>;
  code?: string;
  customer: { name: string; document: string };
};

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly pagarme: PagarmeService,
    private readonly rt: PaymentsRealtime,
    private readonly app: PaymentsAppService,
  ) {}

  // -------- utils --------
  private onlyDigits = (v?: string) => (v || '').replace(/\D+/g, '');
  private up2 = (v?: string) => (v || '').toUpperCase().slice(0, 2);
  private normCountry(v?: string) {
    const s = (v || '').trim().toUpperCase();
    if (s.startsWith('BR') || s === 'BRASIL' || s === 'BRAZIL') return 'BR';
    return this.up2(s) || 'BR';
  }
  private splitPhone(raw?: string) {
    const d = this.onlyDigits(raw);
    return {
      country_code: d.slice(0, 2) || '55',
      area_code: d.slice(2, 4) || '',
      number: d.slice(4) || '',
    };
  }
  private toLineAddress(addr?: FrontAddress) {
    if (!addr) return undefined;
    return {
      line_1: `${addr.street}, ${addr.number}`.trim(),
      line_2: (addr.complement || '').trim() || undefined,
      neighborhood: (addr.neighborhood || '').trim() || undefined,
      zip_code: this.onlyDigits(addr.zip_code),
      city: addr.city,
      state: this.up2(addr.state),
      country: this.normCountry(addr.country),
    };
  }
  private toCardBillingAddress(addr?: FrontAddress) {
    if (!addr) return undefined;
    const parts: string[] = [];
    if (addr.number) parts.push(addr.number);
    if (addr.street) parts.push(addr.street);
    if (addr.neighborhood) parts.push(addr.neighborhood);
    return {
      line_1: parts.join(', '),
      line_2: (addr.complement || '').trim() || undefined,
      zip_code: this.onlyDigits(addr.zip_code),
      city: addr.city,
      state: this.up2(addr.state),
      country: this.normCountry(addr.country),
    };
  }
  // >>> pega userId do middleware OU decodificando o JWT do header (fallback)
  private getUserId(req: any): string | undefined {
    const mid = req?.user?.sub || req?.user?.userId || req?.user?.id;
    if (mid) return String(mid);
    const auth: string | undefined = req?.headers?.authorization;
    if (!auth) return undefined;
    const m = /^Bearer\s+(.+)$/.exec(auth);
    if (!m) return undefined;
    try {
      const payload = JSON.parse(
        Buffer.from(m[1].split('.')[1] || '', 'base64').toString('utf8'),
      );
      return payload?.sub || payload?.userId || payload?.id || payload?._id;
    } catch {
      return undefined;
    }
  }

  // -------- cartão --------
  @Post('charge')
  @HttpCode(202)
  async charge(@Body() body: ChargeBody, @Req() req: any) {
    const planCode = body.metadata?.plan || body.description || 'default';
    const userId = this.getUserId(req); // <- daqui vem o user
    const phone = this.splitPhone(body.customer.phone);
    const card = body.card_token
      ? { token: body.card_token }
      : {
          number: body.cardRaw?.number || '',
          holder_name: body.cardRaw?.holder_name || '',
          exp_month: body.cardRaw?.exp_month || '',
          exp_year: body.cardRaw?.exp_year || '',
          cvv: body.cardRaw?.cvv || '',
        };
    const cardBillingFrom = body.cardBillingAddress || body.billingAddress;

    const order = await this.pagarme.createCardOrderExact({
      amount: body.amount,
      description: body.description || planCode,
      code: planCode,
      customer: {
        name: body.customer.name,
        email: body.customer.email,
        type: 'individual',
        document: body.customer.document,
        phones: phone,
        address: body.customer.address
          ? {
              line_1: this.toLineAddress(body.customer.address)!.line_1,
              line_2: this.toLineAddress(body.customer.address)!.line_2,
              zip_code: this.toLineAddress(body.customer.address)!.zip_code,
              city: this.toLineAddress(body.customer.address)!.city,
              state: this.toLineAddress(body.customer.address)!.state,
              country: this.toLineAddress(body.customer.address)!.country,
            }
          : undefined,
      },
      billingAddress: {
        line_1: this.toLineAddress(body.billingAddress)!.line_1,
        line_2: this.toLineAddress(body.billingAddress)!.line_2,
        neighborhood: this.toLineAddress(body.billingAddress)!.neighborhood,
        zip_code: this.toLineAddress(body.billingAddress)!.zip_code,
        city: this.toLineAddress(body.billingAddress)!.city,
        state: this.toLineAddress(body.billingAddress)!.state,
        country: this.toLineAddress(body.billingAddress)!.country,
      },
      installments: body.installments,
      capture: true,
      card,
      cardBillingAddress: {
        line_1: this.toCardBillingAddress(cardBillingFrom)!.line_1,
        line_2: this.toCardBillingAddress(cardBillingFrom)!.line_2,
        zip_code: this.toCardBillingAddress(cardBillingFrom)!.zip_code,
        city: this.toCardBillingAddress(cardBillingFrom)!.city,
        state: this.toCardBillingAddress(cardBillingFrom)!.state,
        country: this.toCardBillingAddress(cardBillingFrom)!.country,
      },
      metadata: { ...(body.metadata || {}), user_id: userId }, // <- injeta SEMPRE
    });

    try {
      this.rt.emit(order?.id, {
        kind: 'order',
        order_id: order?.id,
        status: order?.status,
        raw: order,
      });
    } catch {}

    // salva PENDING já com userId
    try {
      await this.app.upsertPaymentFromOrder({
        order,
        status: String(order?.status || 'processing').toLowerCase(),
        method: 'credit_card',
        planCode,
        userId,
      });
    } catch {}

    return { id: order?.id, status: order?.status || 'processing' };
  }

  // -------- pix --------
  @Post('pix')
  @HttpCode(200)
  async pix(@Body() body: PixBody, @Req() req: any) {
    const userId = this.getUserId(req);
    const planCode =
      body.code || body.metadata?.plan || body.description || 'default';

    // cria a ordem PIX já com telefone (exigido pela sua conta) e injeta user_id na metadata
    const { normalized, order } = await this.pagarme.createPixOrder({
      amount: body.amount,
      description: body.description || planCode,
      code: planCode,
      customer: {
        name: body.customer.name,
        document: body.customer.document,
        phone: (body as any)?.customer?.phone, // <— envia phone
        email: (body as any)?.customer?.email, // opcional
      },
      expires_in: 600,
      metadata: {
        ...(body.metadata || {}),
        ...(userId ? { user_id: userId } : {}),
      },
    });

    // notifica o front via SSE (status inicial)
    try {
      if (normalized?.order_id) {
        this.rt.emit(normalized.order_id, {
          kind: 'order',
          order_id: normalized.order_id,
          status: String(normalized.status || 'pending').toLowerCase(),
          raw: normalized,
        });
      }
    } catch {}

    // registra/atualiza um pagamento "pending" no banco (para o dashboard)
    try {
      await this.app.upsertPaymentFromOrder({
        order: order || {
          id: normalized.order_id,
          status: normalized.status,
          metadata: { user_id: userId },
        },
        status: String(normalized.status || 'pending').toLowerCase(),
        method: 'pix',
        planCode,
        userId,
      });
    } catch {}

    return { data: normalized };
  }

  // -------- webhook --------
  @Post('webhook')
  async webhook(
    @Body() evt: any,
    @Headers('x-hub-signature') sigHub?: string,
    @Headers('x-pagarme-signature') sigPg?: string,
    @Headers() all?: any,
  ) {
    const reqRaw: any = all?.rawBody;
    if (
      reqRaw &&
      !this.pagarme.verifyWebhookSignature(reqRaw, sigPg || sigHub)
    ) {
      return { ok: false, reason: 'invalid_signature' };
    }

    const type = evt?.type || evt?.event?.type;
    const data = evt?.data || evt?.event?.data;

    const orderId =
      data?.order?.id ??
      (data?.id && String(data.id).startsWith('or_')
        ? data.id
        : evt?.data?.order_id || evt?.order_id);
    const chargeId =
      data?.id && String(data.id).startsWith('ch_') ? data.id : data?.charge_id;
    const tranId =
      data?.id && String(data.id).startsWith('tran_')
        ? data.id
        : data?.transaction_id;
    const status = (data?.status || evt?.status || 'unknown').toLowerCase();

    if (type?.startsWith('order.')) {
      this.rt.emit(orderId, {
        kind: 'order',
        order_id: orderId,
        status,
        raw: evt,
      });
    } else if (type?.startsWith('charge.')) {
      this.rt.emit(orderId, {
        kind: 'charge',
        order_id: orderId,
        charge_id: chargeId,
        status,
        raw: evt,
      });
    } else if (type?.startsWith('transaction.')) {
      this.rt.emit(orderId, {
        kind: 'transaction',
        order_id: orderId,
        transaction_id: tranId,
        status,
        raw: evt,
      });
    } else if (orderId) {
      this.rt.emit(orderId, {
        kind: 'order',
        order_id: orderId,
        status,
        raw: evt,
      });
    }

    // busca a ordem para obter metadata.user_id
    let fresh: any = null;
    try {
      if (orderId) fresh = await this.pagarme.getOrder(orderId);
    } catch {}

    const userIdFromOrder = fresh?.metadata?.user_id || undefined;

    await this.app.recordWebhook(orderId, type, status, evt, userIdFromOrder);

    if (orderId) {
      try {
        const planCode = fresh?.items?.[0]?.code || fresh?.metadata?.plan;
        await this.app.upsertPaymentFromOrder({
          order: fresh || {
            id: orderId,
            status,
            metadata: { user_id: userIdFromOrder },
          },
          status: String(fresh?.status || status).toLowerCase(),
          method: fresh?.charges?.[0]?.payment_method,
          planCode,
          userId: userIdFromOrder,
        });
      } catch {}
    }

    return { ok: true };
  }

  // -------- sse e polling --------
  @Sse('stream/:orderId')
  stream(@Param('orderId') orderId: string): Observable<SseMessageEvent> {
    return this.rt.subscribe(orderId).pipe(map((e) => e));
  }

  @Get('status/:orderId')
  async status(@Param('orderId') orderId: string) {
    const o = await this.pagarme.getOrder(orderId);
    const c = o?.charges?.[0];
    return {
      order_id: o?.id,
      order_status: o?.status,
      charge_status: c?.status,
      last_update: o?.updated_at,
    };
  }

  @Get('me/subscription')
  async meSubscription(@Req() req: any) {
    const userId = this.getUserId(req);
    if (!userId)
      return {
        active: false,
        plan: null,
        period_end: null,
        limits: { monthlyClicksLimit: null, activeDomainsLimit: null },
      };
    return this.app.getActiveSubscriptionSummary(String(userId));
  }
}
