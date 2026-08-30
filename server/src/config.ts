import { readFileSync } from "node:fs";
import type { PoolConfig } from "pg";

function integerEnvironment(name: string, fallback: number): number {
  const value = process.env[name];
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function booleanEnvironment(name: string, fallback = false): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (value == null || value === "") return fallback;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`${name} must be true or false.`);
}

function secret(valueName: string, fileName: string): string | undefined {
  const file = process.env[fileName];
  if (file) return readFileSync(file, "utf8").trim();
  return process.env[valueName];
}

export function databaseConfig(): PoolConfig {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL, max: integerEnvironment("DATABASE_POOL_SIZE", 10) };
  const password = secret("DATABASE_PASSWORD", "DATABASE_PASSWORD_FILE");
  if (!password) throw new Error("DATABASE_PASSWORD or DATABASE_PASSWORD_FILE is required.");
  return {
    host: process.env.DATABASE_HOST ?? "127.0.0.1",
    port: integerEnvironment("DATABASE_PORT", 5432),
    database: process.env.DATABASE_NAME ?? "nesti",
    user: process.env.DATABASE_USER ?? "nesti_api",
    password,
    max: integerEnvironment("DATABASE_POOL_SIZE", 10)
  };
}

export function runtimeDatabasePassword(): string {
  const password = secret("DATABASE_RUNTIME_PASSWORD", "DATABASE_RUNTIME_PASSWORD_FILE");
  if (!password) throw new Error("DATABASE_RUNTIME_PASSWORD or DATABASE_RUNTIME_PASSWORD_FILE is required for migrations.");
  return password;
}

export const serverConfig = {
  port: integerEnvironment("PORT", 3000),
  name: process.env.NESTI_SERVER_NAME?.trim() || "nesti. self-hosted",
  openEnrollment: booleanEnvironment("NESTI_OPEN_ENROLLMENT"),
  maximumBodyBytes: integerEnvironment("MAX_BODY_BYTES", 1_048_576),
  pairingPepper: secret("PAIRING_PEPPER", "PAIRING_PEPPER_FILE")
};
