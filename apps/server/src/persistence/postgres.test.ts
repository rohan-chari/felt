import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { describe, it } from "vitest";
import { runPersistenceContract } from "./contract.js";
import { PostgresPersistence } from "./postgres.js";

/**
 * Probes whether the local Docker daemon is reachable. testcontainers will
 * throw at container start if Docker isn't running; we'd rather skip the suite
 * cleanly so the rest of the test run still passes on machines without Docker.
 */
async function dockerAvailable(): Promise<boolean> {
  try {
    const container = await new PostgreSqlContainer("postgres:16-alpine").start();
    await container.stop({ timeout: 1 });
    return true;
  } catch {
    return false;
  }
}

const hasDocker = await dockerAvailable();

if (!hasDocker) {
  describe.skip("Persistence contract: PostgresPersistence (Docker not available)", () => {
    it("skipped", () => {});
  });
} else {
  let container: StartedPostgreSqlContainer | null = null;

  runPersistenceContract("PostgresPersistence", async () => {
    // Spin up a fresh container per test for isolation. Slower, but guarantees
    // no cross-test state and handles `close()` deterministically.
    const c = await new PostgreSqlContainer("postgres:16-alpine").start();
    container = c;
    const persistence = new PostgresPersistence({
      connectionString: c.getConnectionUri(),
    });
    return {
      persistence,
      teardown: async () => {
        await c.stop({ timeout: 5 });
        container = null;
      },
    };
  });
}
