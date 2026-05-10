import { MemoryPersistence } from "./persistence/memory.js";
import { PostgresPersistence } from "./persistence/postgres.js";
import type { Persistence } from "./persistence/types.js";
import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 8080);
const corsOrigin = process.env.CORS_ORIGIN ?? "*";

const persistence: Persistence = process.env.DATABASE_URL
  ? new PostgresPersistence({ connectionString: process.env.DATABASE_URL })
  : new MemoryPersistence();

const handle = await createServer({ port, corsOrigin, persistence });
console.log(
  `server up on :${handle.port} (persistence: ${process.env.DATABASE_URL ? "postgres" : "memory"})`,
);

const shutdown = async (signal: string) => {
  console.log(`received ${signal}, shutting down`);
  await handle.close();
  await persistence.close();
  process.exit(0);
};
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
