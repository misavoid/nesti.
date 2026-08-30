import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { ApiError } from "./errors.js";
import { parsePairRequest, parseSyncRequest, ProtocolError, SYNC_PROTOCOL_VERSION, MAX_SYNC_MUTATIONS } from "./protocol.js";
import type { DeviceIdentity, SyncRepository } from "./repository.js";
import { serverConfig } from "./config.js";

interface ErrorBody {
  error: { code: string; message: string; requestId: string };
}

function json(response: ServerResponse, status: number, value: unknown, requestId: string): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Request-ID": requestId
  });
  response.end(body);
}

function empty(response: ServerResponse, status: number, requestId: string): void {
  response.writeHead(status, { "Cache-Control": "no-store", "X-Request-ID": requestId });
  response.end();
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") throw new ApiError(415, "unsupported_media_type", "Content-Type must be application/json.");
  const declaredLength = Number(request.headers["content-length"] ?? 0);
  if (declaredLength > serverConfig.maximumBodyBytes) throw new ApiError(413, "request_too_large", "The request body is too large.");

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > serverConfig.maximumBodyBytes) throw new ApiError(413, "request_too_large", "The request body is too large.");
    chunks.push(buffer);
  }
  if (size === 0) throw new ApiError(400, "invalid_json", "A JSON request body is required.");
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new ApiError(400, "invalid_json", "The request body is not valid JSON.");
  }
}

function bearerToken(request: IncomingMessage): string {
  const authorization = request.headers.authorization;
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/);
  if (!match?.[1]) throw new ApiError(401, "missing_token", "A device bearer token is required.");
  return match[1];
}

class WindowRateLimit {
  private timestamps: number[] = [];

  constructor(private readonly maximum: number, private readonly windowMilliseconds: number) {}

  take(): boolean {
    const threshold = Date.now() - this.windowMilliseconds;
    this.timestamps = this.timestamps.filter((timestamp) => timestamp > threshold);
    if (this.timestamps.length >= this.maximum) return false;
    this.timestamps.push(Date.now());
    return true;
  }
}

export type SyncService = Pick<SyncRepository, "ready" | "pair" | "authenticate" | "snapshot" | "sync" | "revoke">;

export function makeHttpServer(repository: SyncService) {
  const pairingLimit = new WindowRateLimit(20, 60_000);

  return createServer(async (request, response) => {
    const requestId = randomUUID();
    const startedAt = Date.now();
    let responseStatus = 500;
    try {
      const method = request.method ?? "GET";
      const path = new URL(request.url ?? "/", "http://localhost").pathname.replace(/\/$/, "") || "/";

      if (method === "GET" && path === "/health/live") {
        responseStatus = 200;
        json(response, 200, { status: "ok" }, requestId);
        return;
      }
      if (method === "GET" && path === "/health/ready") {
        await repository.ready();
        responseStatus = 200;
        json(response, 200, { status: "ready" }, requestId);
        return;
      }
      if (method === "GET" && path === "/api/sync/v1/discovery") {
        responseStatus = 200;
        json(response, 200, {
          name: serverConfig.name,
          protocolVersions: [SYNC_PROTOCOL_VERSION],
          authenticationMethods: ["pairing_code"],
          limits: { maximumBodyBytes: serverConfig.maximumBodyBytes, maximumMutations: MAX_SYNC_MUTATIONS }
        }, requestId);
        return;
      }
      if (method === "POST" && path === "/api/sync/v1/pair") {
        if (!pairingLimit.take()) throw new ApiError(429, "rate_limited", "Too many pairing attempts. Try again later.");
        const pairing = parsePairRequest(await readJson(request));
        const result = await repository.pair(pairing.code, pairing.deviceName);
        responseStatus = 201;
        json(response, 201, { protocolVersion: SYNC_PROTOCOL_VERSION, ...result }, requestId);
        return;
      }

      let device: DeviceIdentity | undefined;
      if (path.startsWith("/api/sync/v1/")) device = await repository.authenticate(bearerToken(request));

      if (method === "GET" && path === "/api/sync/v1/snapshot" && device) {
        const snapshot = await repository.snapshot(device);
        responseStatus = 200;
        json(response, 200, snapshot, requestId);
        return;
      }
      if (method === "POST" && path === "/api/sync/v1/sync" && device) {
        const result = await repository.sync(device, parseSyncRequest(await readJson(request)));
        responseStatus = 200;
        json(response, 200, result, requestId);
        return;
      }
      if (method === "DELETE" && path === "/api/sync/v1/devices/current" && device) {
        await repository.revoke(device);
        responseStatus = 204;
        empty(response, 204, requestId);
        return;
      }

      throw new ApiError(404, "not_found", "The requested endpoint does not exist.");
    } catch (error) {
      const normalized = error instanceof ApiError
        ? error
        : error instanceof ProtocolError
          ? new ApiError(error.code === "unsupported_protocol" ? 409 : 400, error.code, error.message)
          : new ApiError(500, "internal_error", "The server could not complete the request.");
      responseStatus = normalized.status;
      if (!response.headersSent) {
        const body: ErrorBody = { error: { code: normalized.code, message: normalized.message, requestId } };
        json(response, normalized.status, body, requestId);
      } else {
        response.destroy();
      }
      if (normalized.status >= 500) {
        process.stderr.write(JSON.stringify({ level: "error", requestId, message: error instanceof Error ? error.message : String(error) }) + "\n");
      }
    } finally {
      process.stdout.write(JSON.stringify({
        level: "info",
        requestId,
        method: request.method,
        path: new URL(request.url ?? "/", "http://localhost").pathname,
        status: responseStatus,
        durationMilliseconds: Date.now() - startedAt
      }) + "\n");
    }
  });
}
