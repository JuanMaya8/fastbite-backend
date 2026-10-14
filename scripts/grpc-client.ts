// Demo client that talks NATIVE gRPC (HTTP/2) to the backend.
// Run the server first (`npm run dev`), then in another terminal: `npm run demo`.
//
// This is what a backend service, a mobile app or a CLI would do. The browser
// cannot do this (it uses gRPC-Web instead), so this script proves the server
// is a real gRPC server.
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { DeliveryService, OrderStatus } from "../src/gen/fastbite/v1/delivery_pb.js";

const baseUrl = process.env.GRPC_URL ?? "http://localhost:50051";
const client = createClient(DeliveryService, createGrpcTransport({ baseUrl }));

const cop = new Intl.NumberFormat("es-CO", {
  style: "currency",
  currency: "COP",
  maximumFractionDigits: 0,
});

async function main(): Promise<void> {
  console.log(`Calling native gRPC server at ${baseUrl}\n`);

  // 1. Unary call
  const { items } = await client.listMenu({});
  console.log("Menu:");
  for (const item of items) {
    console.log(`  ${item.emoji} ${item.name.padEnd(20)} ${cop.format(item.priceCop)}`);
  }

  // 2. Error handling: gRPC status codes arrive as ConnectError
  try {
    await client.createOrder({ customerName: "", deliveryAddress: "Somewhere", lines: [] });
  } catch (error) {
    const err = ConnectError.from(error);
    console.log(`\nExpected validation error -> ${Code[err.code]}: ${err.rawMessage}`);
  }

  // 3. Create an order (unary)
  const { order } = await client.createOrder({
    customerName: "Ada Lovelace",
    deliveryAddress: "Calle 10 #5-20",
    lines: [
      { menuItemId: "bandeja-paisa", quantity: 1 },
      { menuItemId: "limonada-coco", quantity: 2 },
    ],
  });
  if (!order) throw new Error("Server returned no order");
  console.log(`\nOrder ${order.id} created. Total: ${cop.format(order.totalCop)}`);

  // 4. Server streaming: iterate over updates as the server pushes them
  console.log("\nLive tracking (server streaming):");
  let updates = 0;
  for await (const update of client.trackOrder({ orderId: order.id })) {
    updates++;
    const progress = `${Math.round(update.routeProgress * 100)}%`.padStart(4);
    console.log(
      `  [${OrderStatus[update.status].padEnd(10)}] ${progress} | ETA ${String(update.etaSeconds).padStart(2)}s | ${update.message}`,
    );
  }

  console.log(`\nStream closed by the server after ${updates} updates. gRPC works!`);
}

main().catch((error) => {
  console.error("Demo failed. Is the backend running (`npm run dev`)?");
  console.error(error);
  process.exit(1);
});
