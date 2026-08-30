# Deploy nesti. behind the shared Traefik proxy

The production Compose stack serves nesti. at `https://nesti.misavoid.dev` through the Traefik instance already managed by the Virtus stack. A normal deployment starts the static app, nesti. sync API, one-shot migrations, and PostgreSQL without publishing the database or API directly on host ports.

## DNS

The working Virtus deployment uses the private `misavoid.dev` zone hosted by Technitium at `dns1.tofu.kitchen`. Add an A record there that matches the Virtus target:

```text
nesti.misavoid.dev -> 192.168.0.142
```

The Hetzner integration is still required for temporary `_acme-challenge` TXT records used by Let's Encrypt DNS-01 validation; it does not create the A record used by browsers. Open inbound TCP ports `80` and `443` on the server firewall.

## Shared proxy

Start the Virtus Traefik service first and confirm its Docker network exists:

```sh
docker network inspect virtus_default
```

The existing proxy owns host ports `80` and `443`, the HTTP-to-HTTPS redirect, the Hetzner DNS API token, and the persistent Let's Encrypt ACME volume. Do not start another Traefik container for nesti.

If the shared proxy network has a different name, create `web/.env` from `web/.env.example` and set `TRAEFIK_NETWORK` to that name. The normal Virtus Compose network is `virtus_default`.

## Start

### Full stack

The one-shot `init-secrets` service creates the database passwords and pairing pepper during the first deployment. They persist in the `nesti-secrets` named volume; no host files or preparatory shell commands are required. Back up that volume together with the database volume.

Run from `web/` so Compose automatically reads its `.env` file:

```sh
docker compose config --quiet
docker compose down --remove-orphans
docker compose up -d --build --remove-orphans
```

The `down` command removes the failed `nesti-traefik-1` container created by the earlier standalone-proxy configuration. It does not remove or restart the external Virtus proxy.

Verify the app and the shared proxy:

```sh
docker compose ps
docker compose logs --tail=100 app
docker compose logs --tail=100 migrate sync-api db
docker logs --tail=100 virtus-traefik-1
curl -I https://nesti.misavoid.dev/
curl https://nesti.misavoid.dev/api/sync/v1/discovery
```

After this release, confirm the migration log includes both `001_initial.sql` and `002_profiles.sql`. Pair one browser, create a second profile, complete a task, wait for the UI to show `Saved to PostgreSQL`, and verify the committed server rows:

```sh
docker compose exec -T db psql -U nesti_owner -d nesti -c "select count(*) as profiles from profiles where deleted_at is null;"
docker compose exec -T db psql -U nesti_owner -d nesti -c "select count(*) as attributed_completions from completion_records where deleted_at is null and profile_id is not null;"
```

Repeat with the iOS app using a new pairing code and confirm changes from each client appear on the other before declaring the deployment complete.

If the hostname does not resolve, compare the private records directly:

```sh
dig @192.168.0.60 virtus.misavoid.dev A
dig @192.168.0.60 nesti.misavoid.dev A
```

Traefik discovers the `nesti` routers through Docker labels, uses the existing `myhetznerresolver` certificate resolver, and forwards static traffic to `app` and `/api/sync/v1` traffic to `sync-api` over `virtus_default`.

The one-shot `init-secrets` service provisions persistent credentials, and `migrate` owns schema changes and provisions the least-privilege `nesti_api` database role. The `sync-api` service starts only after migrations succeed. PostgreSQL is attached only to the internal `sync-data` network and stores its files in the `nesti-db` named volume.

The normal first-run flow is available in the website under Settings. Select **Set up this server** once; the browser becomes the first authorized device and displays a 15-minute, one-use pairing code. After setup, **Pair another device** generates subsequent codes for iOS or another browser.

The equivalent administration commands remain available for recovery and scripted deployments:

```sh
docker compose run --rm sync-api node dist/admin.js create-home "My Home"
docker compose run --rm sync-api node dist/admin.js issue-pairing-code HOME_UUID 15
```

The pairing code is sensitive until used or expired. Do not paste it into logs or issue trackers.

### Static app only

For a deliberately local-only host, build and start only the `app` service:

```sh
docker compose up -d --build app
```

This mode does not start migrations, the API, or PostgreSQL. Browser data remains only in IndexedDB.

## Database backup and restore

The named volume survives normal container replacement and `docker compose down`, but it is not a backup. Do not use `docker compose down --volumes` in production.

Take encrypted, scheduled PostgreSQL dumps to storage outside the Docker host. A basic manual dump can be streamed without exposing the database port:

```sh
docker compose exec -T db pg_dump -U nesti_owner -d nesti -Fc > nesti-$(date +%F).dump
```

Restores must be tested on a separate clean stack before relying on them. Stop `sync-api`, restore with `pg_restore --clean --if-exists`, run `migrate` again, then verify readiness and a two-client sync before returning traffic. Keep the owner password, API password, and pairing pepper in the deployment secret backup; database dumps do not contain those files.

## Updating sync services

Back up PostgreSQL before changing the pinned major version or applying new migrations. Build and run the one-shot migration before replacing the API:

```sh
docker compose build sync-api migrate
docker compose run --rm migrate
docker compose up -d --no-deps sync-api
```

PostgreSQL major upgrades require an explicit `pg_upgrade` or dump/restore procedure. Never point a new major image directly at an existing volume.
