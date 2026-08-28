# @marklayer/fetcher

A one-endpoint relay that fetches a page from a **fixed IP address**, for the share
viewer's proxy to fall back to.

It is a 3KB self-contained bundle with no dependencies, so the host is an
implementation detail — Fly today, Oracle or a Raspberry Pi tomorrow, and the only
thing that changes is one Worker secret.

## Why this exists

The Worker's `/proxy` fetches the annotated page server-side. Cloudflare egresses
from a shared pool that some hosts block wholesale. Measured against a SiteGround
site, from the real edge:

| Source | Chrome UA | Firefox / curl / Googlebot / no UA |
| --- | --- | --- |
| An ordinary residential IP | 403 | 200, full page |
| Cloudflare Worker | 202 challenge | 202 challenge, every one |
| Cloudflare Container (`104.28.156.35`) | 202 challenge | 202 challenge, every one |

No header changes that, and no Cloudflare product fixes it: Containers egress from
the same space, and a dedicated egress IP is Enterprise-only (Aegis, or Workers VPC
through a Zero Trust egress policy). The remaining move is to fetch from somewhere
else — one small box, one address, ours.

Two things follow from owning the address. A host that blocks us can be asked to
allow one specific IP, which is a request they can actually act on. And its
reputation reflects our own behaviour rather than every Worker on Cloudflare's.

## The user-agent is part of the fix

The relay identifies itself honestly, and that is deliberate. The Worker sends a
Chrome string; a WAF that verifies browsers sees a Chrome claim over a handshake
that plainly is not Chrome, and refuses it — the 403 above came from a plain
residential connection purely because of that header. The same address with
`MarkLayer/1.0` was served the full page. Do not "improve" this by putting a
browser string back.

## Endpoints

    GET /fetch?url=<absolute http(s) URL>
    Authorization: Bearer $FETCHER_TOKEN

Streams the upstream response back with its status and content-type, plus
`x-ml-relay: ok`, `x-ml-final-url` (after redirects) and `x-ml-egress` (this box's
address, so the Worker never has to be told it separately). Relay-level failures
answer with `x-ml-relay: error` and a JSON body, so the Worker can tell "the site
said 403" from "the relay could not reach it".

    GET /health

`{ ok, egress, userAgent }` — `egress` is the address to hand a site owner.

## Guards

An authenticated relay, never an open proxy. No bearer token, no service.
`FETCHER_TOKEN` is required: with it unset the relay authorizes nothing and refuses
everything, which is the correct way to fail.

Targets are checked twice — the URL's hostname text, and every address that
hostname resolves to — with redirects followed by hand so each hop is re-checked
rather than resolved invisibly inside `fetch`. Responses cap at 25 MB and time out
at 20s. The container runs as a non-root user.

## Turning it on

Any host works. Pick one, then point the Worker at it:

    cd apps/worker
    bunx wrangler secret put FETCHER_URL         # https://your-host.example
    bunx wrangler secret put FETCHER_TOKEN       # same value as the relay's

With either secret unset the Worker never falls back — exactly how it behaved
before this existed.

### Fly (what is running today)

    flyctl apps create marklayer-fetcher --org personal
    flyctl secrets set FETCHER_TOKEN=$(openssl rand -hex 32) -a marklayer-fetcher --stage
    flyctl deploy -c apps/fetcher/deploy/fly.toml --ha=false

`--ha=false` matters more than it looks. Fly's default launches two machines, and
**each machine egresses from its own NAT address** — the first deploy here produced
`204.93.227.93` and `212.11.41.194`, which defeats the entire point. One machine,
one address. Check after any deploy:

    for i in $(seq 5); do curl -s https://marklayer-fetcher.fly.dev/health | jq -r .egress; done

Note the inbound/outbound distinction: Fly's `$2/mo` dedicated IPv4 is the address
people connect *to*. The address a target site sees is the machine's egress NAT,
which is a different thing and is not something the dedicated IPv4 buys. We do not
allocate one — the Worker reaches the relay by hostname over the shared IPv4, and
the egress address is what gets published for allowlisting.

### Any VM — Oracle Always Free, Hetzner, a spare box

No Docker needed; it is one file and one runtime.

    bun run build                                                  # → dist/server.js
    scp dist/server.js user@host:/opt/marklayer-fetcher/server.js
    scp apps/fetcher/deploy/marklayer-fetcher.service user@host:/etc/systemd/system/

Then on the host:

    curl -fsSL https://bun.sh/install | bash && install -m755 ~/.bun/bin/bun /usr/local/bin/bun
    useradd -r -s /usr/sbin/nologin marklayer
    printf 'FETCHER_TOKEN=%s\n' "$(openssl rand -hex 32)" > /etc/marklayer-fetcher.env
    chmod 400 /etc/marklayer-fetcher.env
    systemctl enable --now marklayer-fetcher

Put it behind a TLS terminator (Caddy is two lines) so the Worker talks HTTPS.

### Docker anywhere else

    docker build -f apps/fetcher/Dockerfile -t marklayer-fetcher .
    docker run -d -p 8080:8080 -e FETCHER_TOKEN=... marklayer-fetcher

## Switching hosts

Nothing in the relay knows where it runs, so a move is three steps:

1. Stand the new host up and confirm the address: `curl https://new-host/health`
2. `bunx wrangler secret put FETCHER_URL` (and `FETCHER_EGRESS_IP` for the address
   shown to blocked users)
3. Tear the old host down

No redeploy of the Worker, no code change. Do it in that order and there is no
window where the fallback is pointing at nothing.

## Turning it off

Three levers, in increasing severity:

- `bunx wrangler secret put FETCHER_ENABLED` → `false`. The fallback stops, config
  intact. This is the flag to reach for first.
- `bunx wrangler secret delete FETCHER_URL`. Same effect, config gone.
- Do nothing at all. If the host simply vanishes — a cancelled account, an expired
  card — the Worker's circuit breaker trips after three failed calls and stops
  trying for a minute at a time. The proxy degrades to exactly its old behaviour on
  its own, and blocked pages show the firewall message rather than hanging.

That last one is the important one: **the relay disappearing is not an outage.**
It is a feature that stops working, and everything else carries on.
