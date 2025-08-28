import { Injectable, MessageEvent } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export type UpdateKind = 'order' | 'charge' | 'transaction';
export interface Update {
  kind: UpdateKind;
  order_id: string;
  status: string;
  charge_id?: string;
  transaction_id?: string;
  raw?: any;
}

@Injectable()
export class PaymentsRealtime {
  private chans = new Map<string, Subject<MessageEvent>>();

  private ensure(orderId: string) {
    let s = this.chans.get(orderId);
    if (!s) {
      s = new Subject<MessageEvent>();
      this.chans.set(orderId, s);
    }
    return s;
  }

  subscribe(orderId: string): Observable<MessageEvent> {
    return this.ensure(orderId).asObservable();
  }

  emit(orderId: string, update: Update) {
    this.ensure(orderId).next({ data: update });
  }
}
