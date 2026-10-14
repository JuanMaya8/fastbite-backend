import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { DeliveryService } from "./gen/fastbite/v1/delivery_pb.js";
import {
  isFinalStatus,
  type DeliveryStore,
  type OrderData,
  type UpdateData,
} from "./store.js";

const MAX_LINES = 20;
const MAX_QUANTITY = 20;

// Conversion helpers: domain objects -> protobuf message init objects.
// (int64 fields are `bigint` in generated TypeScript.)
const toOrderMessage = (order: OrderData) => ({
  id: order.id,
  customerName: order.customerName,
  deliveryAddress: order.deliveryAddress,
  lines: order.lines,
  totalCop: order.totalCop,
  status: order.status,
  createdAtMs: BigInt(order.createdAtMs),
});

const toUpdateMessage = (update: UpdateData) => ({
  orderId: update.orderId,
  status: update.status,
  message: update.message,
  routeProgress: update.routeProgress,
  etaSeconds: update.etaSeconds,
  timestampMs: BigInt(update.timestampMs),
});

function requireOrder(store: DeliveryStore, orderId: string): OrderData {
  const order = store.getOrder(orderId.trim().toUpperCase());
  if (!order) {
    throw new ConnectError(`Order "${orderId}" was not found.`, Code.NotFound);
  }
  return order;
}

export function createRoutes(store: DeliveryStore) {
  return (router: ConnectRouter) => {
    router.service(DeliveryService, {
      // ---------------------------------------------------------------
      // Unary RPC: one request, one response.
      // ---------------------------------------------------------------
      async listMenu() {
        return { items: store.listMenu() };
      },

      async createOrder(request) {
        const customerName = request.customerName.trim();
        const deliveryAddress = request.deliveryAddress.trim();

        if (customerName.length === 0 || customerName.length > 60) {
          throw new ConnectError("customer_name is required (max 60 characters).", Code.InvalidArgument);
        }
        if (deliveryAddress.length === 0 || deliveryAddress.length > 120) {
          throw new ConnectError("delivery_address is required (max 120 characters).", Code.InvalidArgument);
        }
        if (request.lines.length === 0 || request.lines.length > MAX_LINES) {
          throw new ConnectError(`An order needs between 1 and ${MAX_LINES} lines.`, Code.InvalidArgument);
        }

        let totalCop = 0;
        for (const line of request.lines) {
          const item = store.findMenuItem(line.menuItemId);
          if (!item) {
            throw new ConnectError(`Unknown menu item "${line.menuItemId}".`, Code.InvalidArgument);
          }
          if (line.quantity < 1 || line.quantity > MAX_QUANTITY) {
            throw new ConnectError(
              `Quantity for "${item.name}" must be between 1 and ${MAX_QUANTITY}.`,
              Code.InvalidArgument,
            );
          }
          // The server always computes the price: never trust the client.
          totalCop += item.priceCop * line.quantity;
        }

        const order = store.createOrder({
          customerName,
          deliveryAddress,
          lines: request.lines.map((line) => ({
            menuItemId: line.menuItemId,
            quantity: line.quantity,
          })),
          totalCop,
        });
        return { order: toOrderMessage(order) };
      },

      async getOrder(request) {
        return { order: toOrderMessage(requireOrder(store, request.orderId)) };
      },

      async cancelOrder(request) {
        const order = requireOrder(store, request.orderId);
        if (!store.cancelOrder(order)) {
          throw new ConnectError(
            "This order can no longer be cancelled (the courier already left or it is finished).",
            Code.FailedPrecondition,
          );
        }
        return { order: toOrderMessage(order) };
      },

      // ---------------------------------------------------------------
      // Server streaming RPC: one request, many responses over time.
      // An async generator is the natural way to write it: every `yield`
      // sends one message to the client.
      // ---------------------------------------------------------------
      async *trackOrder(request, context) {
        const order = requireOrder(store, request.orderId);

        const last = store.getLastUpdate(order.id);
        if (!last) {
          throw new ConnectError("Order has no tracking data.", Code.Internal);
        }

        // Already finished: send the final state once and close the stream.
        if (isFinalStatus(last.status)) {
          yield toUpdateMessage(last);
          return;
        }

        // Subscribe BEFORE yielding anything so no update is lost.
        const live = store.subscribe(order.id, context.signal);
        try {
          yield toUpdateMessage(last);
          for await (const [update] of live) {
            const data = update as UpdateData;
            yield toUpdateMessage(data);
            if (isFinalStatus(data.status)) return;
          }
        } catch (error) {
          // The client closed the connection: that is normal, not an error.
          if (context.signal.aborted) return;
          throw error;
        }
      },
    });
  };
}
