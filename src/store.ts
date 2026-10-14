import { EventEmitter, on } from "node:events";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { OrderStatus } from "./gen/fastbite/v1/delivery_pb.js";

// ---------------------------------------------------------------------------
// Plain domain types. The gRPC layer (service.ts) converts them to protobuf
// messages, so this file knows nothing about networking.
// ---------------------------------------------------------------------------

export interface MenuItemData {
  id: string;
  name: string;
  description: string;
  priceCop: number;
  emoji: string;
}

export interface OrderLineData {
  menuItemId: string;
  quantity: number;
}

export interface OrderData {
  id: string;
  customerName: string;
  deliveryAddress: string;
  lines: OrderLineData[];
  totalCop: number;
  status: OrderStatus;
  createdAtMs: number;
}

export interface UpdateData {
  orderId: string;
  status: OrderStatus;
  message: string;
  routeProgress: number;
  etaSeconds: number;
  timestampMs: number;
}

export const MENU: MenuItemData[] = [
  {
    id: "bandeja-paisa",
    name: "Bandeja paisa",
    description: "Rice, beans, chicharron, egg, plantain and avocado.",
    priceCop: 32000,
    emoji: "🍛",
  },
  {
    id: "empanadas",
    name: "Empanadas (x3)",
    description: "Crispy corn empanadas with aji sauce.",
    priceCop: 9000,
    emoji: "🥟",
  },
  {
    id: "arepa-queso",
    name: "Arepa with cheese",
    description: "Grilled white corn arepa stuffed with melted cheese.",
    priceCop: 7500,
    emoji: "🫓",
  },
  {
    id: "ajiaco",
    name: "Ajiaco",
    description: "Chicken and potato soup with corn, capers and cream.",
    priceCop: 28000,
    emoji: "🍲",
  },
  {
    id: "burger",
    name: "House burger",
    description: "Beef patty, cheese, lettuce, tomato and fries.",
    priceCop: 25000,
    emoji: "🍔",
  },
  {
    id: "limonada-coco",
    name: "Coconut lemonade",
    description: "Fresh lime juice blended with coconut cream.",
    priceCop: 10000,
    emoji: "🥥",
  },
];

export const isFinalStatus = (status: OrderStatus): boolean =>
  status === OrderStatus.DELIVERED || status === OrderStatus.CANCELLED;

// Simulation timeline, in "simulated" seconds. Divided by SIMULATION_SPEED
// to get real time, so the demo can be sped up without touching the code.
const PREPARING_AFTER_S = 3;
const KITCHEN_TIME_S = 7;
const TRIP_TICKS = 15; // one tick per simulated second

export class DeliveryStore {
  private readonly orders = new Map<string, OrderData>();
  private readonly lastUpdates = new Map<string, UpdateData>();
  private readonly emitter = new EventEmitter();

  constructor(private readonly speed: number = 1) {
    // Every open TrackOrder stream is one listener; do not warn about that.
    this.emitter.setMaxListeners(0);
  }

  listMenu(): MenuItemData[] {
    return MENU;
  }

  findMenuItem(id: string): MenuItemData | undefined {
    return MENU.find((item) => item.id === id);
  }

  getOrder(id: string): OrderData | undefined {
    return this.orders.get(id);
  }

  getLastUpdate(id: string): UpdateData | undefined {
    return this.lastUpdates.get(id);
  }

  createOrder(input: {
    customerName: string;
    deliveryAddress: string;
    lines: OrderLineData[];
    totalCop: number;
  }): OrderData {
    const order: OrderData = {
      id: randomUUID().slice(0, 8).toUpperCase(),
      customerName: input.customerName,
      deliveryAddress: input.deliveryAddress,
      lines: input.lines,
      totalCop: input.totalCop,
      status: OrderStatus.PLACED,
      createdAtMs: Date.now(),
    };
    this.orders.set(order.id, order);

    const totalEta = PREPARING_AFTER_S + KITCHEN_TIME_S + TRIP_TICKS;
    this.publish(order, "Order received. The restaurant has been notified.", 0, totalEta);

    // Fire and forget: the simulation keeps running in the background.
    void this.simulate(order).catch((error) => {
      console.error(`Simulation failed for order ${order.id}`, error);
    });

    return order;
  }

  /** Returns false if the order can no longer be cancelled. */
  cancelOrder(order: OrderData): boolean {
    if (order.status !== OrderStatus.PLACED && order.status !== OrderStatus.PREPARING) {
      return false;
    }
    order.status = OrderStatus.CANCELLED;
    this.publish(order, "Order cancelled.", 0, 0);
    return true;
  }

  /**
   * Starts listening for updates of one order. The listener is registered
   * immediately (not on first read), so no update can be missed between
   * "read the last update" and "start iterating".
   */
  subscribe(orderId: string, signal: AbortSignal): AsyncIterableIterator<unknown[]> {
    return on(this.emitter, orderId, { signal });
  }

  private publish(order: OrderData, message: string, routeProgress: number, etaSeconds: number): void {
    const update: UpdateData = {
      orderId: order.id,
      status: order.status,
      message,
      routeProgress,
      etaSeconds,
      timestampMs: Date.now(),
    };
    this.lastUpdates.set(order.id, update);
    this.emitter.emit(order.id, update);
  }

  private wait(simulatedSeconds: number): Promise<void> {
    return sleep((simulatedSeconds * 1000) / this.speed);
  }

  private async simulate(order: OrderData): Promise<void> {
    await this.wait(PREPARING_AFTER_S);
    if (order.status === OrderStatus.CANCELLED) return;
    order.status = OrderStatus.PREPARING;
    this.publish(order, "The kitchen is preparing your food.", 0, KITCHEN_TIME_S + TRIP_TICKS);

    await this.wait(KITCHEN_TIME_S);
    if (order.status === OrderStatus.CANCELLED) return;
    order.status = OrderStatus.ON_THE_WAY;
    this.publish(order, "Your courier picked up the order and is on the way.", 0, TRIP_TICKS);

    for (let tick = 1; tick < TRIP_TICKS; tick++) {
      await this.wait(1);
      this.publish(order, "Courier is getting closer.", tick / TRIP_TICKS, TRIP_TICKS - tick);
    }

    await this.wait(1);
    order.status = OrderStatus.DELIVERED;
    this.publish(order, "Delivered. Enjoy your meal!", 1, 0);
  }
}
