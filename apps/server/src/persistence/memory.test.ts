import { runPersistenceContract } from "./contract.js";
import { MemoryPersistence } from "./memory.js";

runPersistenceContract("MemoryPersistence", async () => ({
  persistence: new MemoryPersistence(),
  teardown: async () => {},
}));
