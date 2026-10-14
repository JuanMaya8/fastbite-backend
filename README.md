# 🛵 FastBite — Backend (gRPC)

Servidor gRPC de **FastBite**, una app de domicilios con seguimiento del pedido en vivo. Proyecto de la materia **Programación Orientada a la Web**.

Este es el repo del **backend**. El frontend (React) vive en otro repo: `fastbite-frontend`.

> El código está en inglés a propósito (para que sea universal). Este README está en español para que se entienda fácil.

---

## ¿Qué hace?

Expone un servicio gRPC (`DeliveryService`) con estas llamadas:

| Llamada | Tipo | Para qué sirve |
|---|---|---|
| `ListMenu` | Unary | Devuelve el menú |
| `CreateOrder` | Unary | Crea un pedido (el servidor calcula el total, nunca confía en el cliente) |
| `GetOrder` | Unary | Consulta un pedido |
| `CancelOrder` | Unary | Cancela un pedido (solo si el repartidor aún no sale) |
| `TrackOrder` | **Server streaming** | El servidor va *empujando* mensajes mientras el pedido avanza: recibido → cocinando → en camino → entregado |

Los datos viven **en memoria** (sin base de datos) y el domicilio es una **simulación** de ~25 segundos. Si reinicias el servidor, los pedidos se borran.

### El contrato

Todo parte de `proto/fastbite/v1/delivery.proto`. De ese archivo se **genera automáticamente** el código TypeScript (carpeta `src/gen`, que no se sube a git) cada vez que corres `npm run dev` o `npm run build`.

### ¿Por qué Connect y no `grpc-js` a secas?

Los navegadores no hablan gRPC "puro", solo **gRPC-Web**. La librería [Connect](https://connectrpc.com) hace que **la misma URL entienda gRPC nativo, gRPC-Web y Connect**, así que no necesitas montar un proxy (Envoy) aparte.

Por eso el servidor abre dos puertos:

- **`PORT` (8080)** → HTTP/1.1 para el navegador (gRPC-Web). Es el que se expone en Render.
- **`GRPC_PORT` (50051)** → gRPC **nativo** (HTTP/2). Solo se abre en local, sirve para el cliente de consola.

---

## Estructura

```
fastbite-backend/
├── proto/                    ← Contrato gRPC (copia propia de este repo)
│   ├── buf.yaml
│   └── fastbite/v1/delivery.proto
├── src/
│   ├── server.ts             ← Arranca servidores, CORS, health check
│   ├── service.ts            ← Implementa las llamadas gRPC y valida datos
│   └── store.ts              ← Menú, pedidos y simulación del domicilio
├── scripts/grpc-client.ts    ← Cliente de consola con gRPC nativo (demo)
├── buf.gen.yaml              ← Config del generador de código
├── render.yaml               ← Receta opcional para Render
└── package.json
```

---

## Cómo correrlo en tu computador

**Necesitas:** Node.js 20 o superior (`node -v`) e internet para `npm install`. No hace falta instalar `protoc`.

```bash
npm install
npm run dev
```

Debe imprimir:

```
FastBite web API (gRPC-Web / Connect) listening on port 8080
FastBite native gRPC (HTTP/2) listening on port 50051
```

Comprobación rápida: abre <http://localhost:8080/healthz> → debe decir `ok`.

### Probar gRPC nativo con el cliente de consola

Con el servidor corriendo, en otra terminal:

```bash
npm run demo
```

Lista el menú, provoca un error de validación a propósito, crea un pedido y muestra cada mensaje del stream hasta que el servidor lo cierra.

### Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Genera el código desde el `.proto` y arranca con recarga automática |
| `npm run build` | Genera el código y compila TypeScript a `dist/` |
| `npm start` | Arranca la versión compilada (lo que usa Render) |
| `npm run demo` | Cliente de consola con gRPC nativo |
| `npm run generate` | Solo regenera el código desde el `.proto` |

### Variables de entorno

Localmente **no necesitas ninguna**. En producción:

| Variable | Para qué sirve | Ejemplo |
|---|---|---|
| `PORT` | Puerto web. Render lo pone solo | `10000` |
| `CORS_ORIGIN` | URL(s) del frontend autorizadas, separadas por coma, **sin `/` final** | `https://fastbite.vercel.app` |
| `SIMULATION_SPEED` | Acelera el domicilio (1 = ~25 s, 5 = 5 veces más rápido) | `1` |
| `GRPC_PORT` | Puerto gRPC nativo (en producción déjalo sin definir) | `50051` |

---

## Desplegar en Render

1. Sube este repo a GitHub.
2. En <https://render.com> → **New → Web Service** → conecta el repo.
3. Configura:

| Campo | Valor |
|---|---|
| Root Directory | *(déjalo vacío: el backend es la raíz del repo)* |
| Runtime | `Node` |
| Build Command | `npm install --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/healthz` |
| Plan | Free |

   > El `--include=dev` es obligatorio: el generador de código gRPC y TypeScript son dependencias de desarrollo y Render por defecto no las instala.

4. En **Environment** agrega `NODE_VERSION` = `22`.
5. Cuando diga *Live*, copia la URL (ej. `https://fastbite-backend.onrender.com`) y comprueba `…/healthz`.
6. **Después de desplegar el frontend en Vercel**, vuelve aquí y agrega `CORS_ORIGIN` = la URL de Vercel (sin `/` final). Render se reinicia solo.

(Alternativa: **New → Blueprint** usando el `render.yaml` de este repo.)

---

## ⚠️ Mantener el contrato sincronizado con el frontend

Este repo y el del frontend tienen **cada uno su copia** de `proto/fastbite/v1/delivery.proto`. Si cambias el contrato:

1. Edita el `.proto` en el backend y prueba.
2. **Copia el mismo archivo** al repo del frontend (`proto/fastbite/v1/delivery.proto`).
3. Corre `npm run generate` en ambos (o simplemente `npm run dev`).
4. Haz commit en los dos repos.

Si las copias se desincronizan, el frontend y el backend dejarán de entenderse.

---

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| Build en Render falla con `buf: not found` o `tsc: not found` | Falta `--include=dev` en el Build Command |
| El frontend marca error de **CORS** | `CORS_ORIGIN` mal escrito (debe ser exactamente la URL de Vercel, con `https://` y sin `/` final) |
| La primera petición tarda ~1 minuto | Normal en el plan gratis de Render: el servidor se duerme y tarda en despertar |
| `npm run demo` rechaza la conexión | El backend no está corriendo, o estás en producción (el puerto 50051 solo se abre en local) |
