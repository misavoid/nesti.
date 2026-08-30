import { createPool } from "./database.js";
import { SyncRepository } from "./repository.js";
import { parseIdentifier } from "./protocol.js";

const usage = `Usage:
  node dist/admin.js create-home <name>
  node dist/admin.js issue-pairing-code <home-uuid> [valid-minutes]
`;

async function run(): Promise<void> {
  const [command, ...arguments_] = process.argv.slice(2);
  const pool = createPool();
  const repository = new SyncRepository(pool);
  try {
    if (command === "create-home") {
      const name = arguments_.join(" ").trim();
      if (!name || name.length > 200) throw new Error("The home name must contain 1 through 200 characters.");
      const home = await repository.createHome(name);
      process.stdout.write(JSON.stringify(home, null, 2) + "\n");
      return;
    }
    if (command === "issue-pairing-code") {
      const homeId = parseIdentifier(arguments_[0], "home-uuid");
      const validMinutes = arguments_[1] == null ? 15 : Number(arguments_[1]);
      if (!Number.isInteger(validMinutes) || validMinutes < 1 || validMinutes > 1440) {
        throw new Error("valid-minutes must be an integer from 1 through 1440.");
      }
      const pairing = await repository.issuePairingCode(homeId, validMinutes);
      process.stdout.write(JSON.stringify({ homeId, ...pairing }, null, 2) + "\n");
      return;
    }
    throw new Error(usage.trim());
  } finally {
    await pool.end();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n${usage}`);
  process.exitCode = 1;
});
