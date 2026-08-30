import { createPool } from "./database.js";
import { makeHttpServer } from "./http.js";
import { SyncRepository } from "./repository.js";
import { serverConfig } from "./config.js";

const pool = createPool();
const repository = new SyncRepository(pool);
const server = makeHttpServer(repository);

server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 1_000;

server.listen(serverConfig.port, "0.0.0.0", () => {
  process.stdout.write(JSON.stringify({ level: "info", message: "nesti. sync API listening", port: serverConfig.port }) + "\n");
});

async function shutdown(signal: string): Promise<void> {
  process.stdout.write(JSON.stringify({ level: "info", message: "Shutting down", signal }) + "\n");
  server.closeIdleConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.end();
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    shutdown(signal).then(() => process.exit(0)).catch((error: unknown) => {
      process.stderr.write(`Shutdown failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
  });
}
