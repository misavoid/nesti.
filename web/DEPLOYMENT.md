# Deploy nesti. behind the shared Traefik proxy

The production Compose stack serves nesti. at `https://nesti.misavoid.dev` through the Traefik instance already managed by the Virtus stack. The nesti. app container does not publish host ports; it joins Traefik's external Docker network and receives traffic on internal port `8080`.

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
docker logs --tail=100 virtus-traefik-1
curl -I https://nesti.misavoid.dev/
```

If the hostname does not resolve, compare the private records directly:

```sh
dig @192.168.0.60 virtus.misavoid.dev A
dig @192.168.0.60 nesti.misavoid.dev A
```

Traefik discovers the `nesti` router through Docker labels, uses the existing `myhetznerresolver` certificate resolver, and forwards matching requests over `virtus_default`.
