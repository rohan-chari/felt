import { createServer } from "./server.js";

const port = Number(process.env.PORT ?? 8080);
const corsOrigin = process.env.CORS_ORIGIN ?? "*";

const handle = await createServer({ port, corsOrigin });
console.log(`server up on :${handle.port}`);

const shutdown = (signal: string) => {
  console.log(`received ${signal}, shutting down`);
  handle.close();
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
