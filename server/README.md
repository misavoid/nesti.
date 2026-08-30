# nesti. sync server

The sync server is the optional PostgreSQL-backed authority for paired nesti. homes. Native and web clients keep complete offline replicas and communicate only with the versioned HTTP API; they never connect to PostgreSQL directly.

See `docs/SYNC_PROTOCOL.md` for the wire contract and `web/DEPLOYMENT.md` for the Compose stack, secrets, administration commands, backups, and upgrades.

## Development checks

```sh
npm ci
npm run check
npm test
npm run build
```

The normal unit suite does not require PostgreSQL. The repository integration suite requires a disposable, migrated database owned by a role that can clean up its test homes:

```sh
TEST_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/nesti npm run test:integration
```

CI must run this suite against PostgreSQL. It covers pairing-code consumption, mutation idempotency, ordered changes, revision conflicts, and device revocation.

## Administration

After compiling and configuring the database environment:

```sh
node dist/admin.js create-home "My Home"
node dist/admin.js issue-pairing-code HOME_UUID 15
```

Pairing codes are one-use credentials and expire after the requested number of minutes. The API returns device bearer tokens only in the successful pairing response.
