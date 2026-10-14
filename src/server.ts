import http from "node:http";
import http2 from "node:http2";
import { cors as connectCors } from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import { createRoutes } from "./service.js";
import { DeliveryStore } from "./store.js";

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT ?? 8080);
const grpcPort = process.env.GRPC_PORT ?? (isProduction ? undefined : "50051");
const speed = Math.max(0.1, Number(process.env.SIMULATION_SPEED ?? 1));

// "https://a.vercel.app, http://localhost:5173" -> ["https://a.vercel.app", "http://localhost:5173"]
const allowedOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

function isOriginAllowed(origin: string): boolean {
  return allowedOrigins.length === 0 || allowedOrigins.includes(origin);
}

const store = new DeliveryStore(speed);

// One handler that understands three protocols on the same URL:
//   1. gRPC (native, HTTP/2)      -> used by servers, mobile apps, CLI tools
//   2. gRPC-Web                   -> used by browsers (our React frontend)
//   3. Connect protocol           -> simple JSON/protobuf over HTTP
const grpcHandler = connectNodeAdapter({ routes: createRoutes(store) });

// Port 1: HTTP/1.1 + CORS, what browsers (through Render's proxy) talk to.
const webServer = http.createServer((req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    return;
  }

  const origin = req.headers.origin;
  if (origin && isOriginAllowed(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Expose-Headers", connectCors.exposedHeaders.join(", "));
  }

  // Browsers send a "preflight" OPTIONS request before the real call.
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", connectCors.allowedMethods.join(", "));
    res.setHeader("Access-Control-Allow-Headers", connectCors.allowedHeaders.join(", "));
    res.setHeader("Access-Control-Max-Age", "7200");
    res.writeHead(204).end();
    return;
  }

  grpcHandler(req, res);
});

webServer.listen(port, "0.0.0.0", () => {
  console.log(`FastBite web API (gRPC-Web / Connect) listening on port ${port}`);
  console.log(`  health check: http://localhost:${port}/healthz`);
  console.log(`  allowed origins: ${allowedOrigins.length ? allowedOrigins.join(", ") : "ANY (set CORS_ORIGIN in production)"}`);
  console.log(`  simulation speed: x${speed}`);
});

// Port 2 (optional): native gRPC over cleartext HTTP/2 (h2c).
// Browsers cannot speak native gRPC, but any gRPC client can (grpcurl, Go,
// Python, Java, `npm run demo`...). Handy for demos and tests.
let nativeGrpcServer: http2.Http2Server | undefined;
if (grpcPort) {
  nativeGrpcServer = http2.createServer(grpcHandler);
  nativeGrpcServer.listen(Number(grpcPort), "0.0.0.0", () => {
    console.log(`FastBite native gRPC (HTTP/2) listening on port ${grpcPort}`);
  });
}

function shutdown(signal: string): void {
  console.log(`${signal} received, shutting down...`);
  webServer.close();
  nativeGrpcServer?.close();
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
