# OPS — knowless operator setup

This guide takes a fresh Ubuntu/Debian VPS to "knowless is delivering
magic-link mail to your users' inbox." Every step is a manual decision
point for the operator. There are no automation scripts; ops is your
job and we provide the checklist.

If any step here surprises you — outbound port 25, DKIM, PTR records,
the null-route requirement — stop and read PRD §11 first. knowless
trades operator effort for a small, auditable surface. If you'd rather
delegate email to a SaaS, knowless is the wrong tool.

---

## 1. Prerequisites

- Ubuntu 22.04 / 24.04 or Debian 12, on a host that can:
  - bind a public DNS name (e.g. `auth.example.com`)
  - send outbound TCP/25 (verify before going further — see §3)
  - have a working PTR record for its public IPv4 (and IPv6 if used)
- A domain with control of its DNS records
- Node.js ≥ 20 installed
- A reverse proxy in front of HTTP (Caddy, nginx, or Traefik)

knowless does not handle TLS termination. Your reverse proxy does.

---

## 2. Install Postfix (outbound-only)

knowless submits mail to a localhost MTA over plain SMTP on port 25
without auth. The MTA does the actual delivery. Postfix is the
recommended choice; any MTA that accepts unauthenticated localhost
submission works.

```sh
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y postfix mailutils
# When the installer asks: choose "Internet Site"
# System mail name: your sending domain (e.g. example.com)
```

Minimal `/etc/postfix/main.cf` for outbound-only:

```
myhostname        = mail.example.com
mydomain          = example.com
myorigin          = $mydomain
inet_interfaces   = loopback-only
inet_protocols    = ipv4
mydestination     =
relayhost         =
smtp_tls_security_level = may
smtp_tls_loglevel       = 1
```

`inet_interfaces = loopback-only` means Postfix accepts submission
only from `127.0.0.1`. knowless connects there. Restart:

```sh
sudo systemctl restart postfix
sudo systemctl enable postfix
```

Verify the localhost submission works:

```sh
echo "Subject: test" | sendmail -v you@somewhere-you-control.com
sudo tail /var/log/mail.log
```

If you see `status=sent` you are done with §2.

---

## 3. Verify outbound port 25

Many cloud providers (AWS, GCP, Azure, Oracle, DigitalOcean droplets,
Hetzner cloud, …) block outbound TCP/25 by default to limit spam from
compromised instances. **Test before troubleshooting anything else.**

```sh
nc -zv gmail-smtp-in.l.google.com 25
# Expected: succeeded / Connection to ... 25 port [tcp/smtp] succeeded
```

If this hangs or fails:
- AWS: open a "Request to remove email sending limitations" ticket.
- GCP: port 25 is permanently blocked. Use a relay (see below) or
  move to a provider that allows it.
- Hetzner: port 25 is blocked on new accounts; ask support.
- Most VPS hosts (Vultr, OVH, Linode, your own metal): open by default.

**Alternative if port 25 is permanently blocked:** configure Postfix
to relay through a transactional provider's submission endpoint
(587/465 with auth). knowless still talks to localhost; Postfix is
what relays out. That's a Postfix concern, not a knowless concern.

---

## 4. Null-route for sham mail (REQUIRED)

knowless's silent-miss design (PRD FR-2 to FR-6) submits a real-shaped
SMTP message on every login attempt — including ones where the email
doesn't map to any registered handle. The "sham" submissions are
addressed to `null@knowless.invalid` by default. Without a null-route,
Postfix will queue these forever trying to resolve a nonexistent
domain. **Configure the null-route. SPEC §7.4.**

```sh
# /etc/postfix/transport
knowless.invalid    discard:silently dropped by knowless null-route
```

Then:

```sh
sudo postmap /etc/postfix/transport
```

Add to `/etc/postfix/main.cf`:

```
transport_maps = hash:/etc/postfix/transport
```

Reload:

```sh
sudo systemctl reload postfix
```

Verify discard works:

```sh
echo "test" | mail -s "should be dropped" null@knowless.invalid
sudo tail /var/log/mail.log | grep knowless.invalid
# Expected: status=sent (silently dropped by knowless null-route)
```

If you customized `shamRecipient` in your knowless config to point
elsewhere, change the transport entry's domain to match.

---

## 5. SPF, DKIM, PTR

Without these your magic-link mail goes to spam. There is no
shortcut here.

### 5.1 SPF

Add a TXT record at the apex of your sending domain:

```
example.com.  TXT  "v=spf1 mx a ~all"
```

If your knowless server is *not* an MX for the domain, replace
`mx` with `ip4:1.2.3.4` listing the server's public IP.

### 5.2 DKIM

Install OpenDKIM:

```sh
sudo apt-get install -y opendkim opendkim-tools
sudo opendkim-genkey -D /etc/opendkim/keys -d example.com -s mail
sudo chown opendkim:opendkim /etc/opendkim/keys/mail.private
sudo chmod 600 /etc/opendkim/keys/mail.private
```

`/etc/opendkim/keys/mail.txt` now contains the DNS record. Publish it
as `mail._domainkey.example.com` in your DNS.

Wire OpenDKIM into Postfix — add to `/etc/postfix/main.cf`:

```
milter_default_action = accept
smtpd_milters         = inet:localhost:8891
non_smtpd_milters     = $smtpd_milters
```

Configure `/etc/opendkim.conf`:

```
Domain                  example.com
KeyFile                 /etc/opendkim/keys/mail.private
Selector                mail
Socket                  inet:8891@localhost
```

Restart both:

```sh
sudo systemctl restart opendkim postfix
```

Verify with `mail-tester.com`: send a test, expect 9–10/10.

### 5.3 PTR (reverse DNS)

Your server's public IP must reverse-resolve to a hostname. **Most
providers expose this in their control panel** (Hetzner: "rDNS";
DigitalOcean: name your droplet `mail.example.com`; OVH: "Reverse
DNS" tab). Set the PTR to the same hostname you put in
`myhostname` (§2). Verify:

```sh
dig -x 1.2.3.4 +short
# Expected: mail.example.com.
```

A missing or generic PTR (`ec2-...`, `static.cloud-provider.tld`)
is the single most common reason mail lands in spam.

### 5.4 Optional: DMARC

```
_dmarc.example.com.  TXT  "v=DMARC1; p=none; rua=mailto:postmaster@example.com"
```

Start with `p=none` to monitor. Move to `p=quarantine` later if you
want stricter handling.

---

## 6. Run knowless-server under systemd

```sh
sudo useradd --system --home /var/lib/knowless --create-home knowless
sudo install -d -o knowless -g knowless -m 0750 /var/lib/knowless /etc/knowless
```

Generate a secret and create `/etc/knowless/knowless.env`:

```sh
sudo install -m 0600 -o knowless -g knowless /dev/null /etc/knowless/knowless.env
sudo tee /etc/knowless/knowless.env > /dev/null <<EOF
KNOWLESS_SECRET=$(openssl rand -hex 32)
KNOWLESS_BASE_URL=https://auth.example.com
KNOWLESS_FROM=auth@example.com
KNOWLESS_DB_PATH=/var/lib/knowless/knowless.db
KNOWLESS_COOKIE_DOMAIN=example.com
KNOWLESS_COOKIE_SECURE=true
KNOWLESS_HOST=127.0.0.1
KNOWLESS_PORT=8080
EOF
sudo chmod 0600 /etc/knowless/knowless.env
```

`/etc/systemd/system/knowless.service`:

```ini
[Unit]
Description=knowless passwordless auth server
Wants=network-online.target postfix.service
After=network-online.target postfix.service

[Service]
Type=simple
User=knowless
Group=knowless
EnvironmentFile=/etc/knowless/knowless.env
ExecStartPre=/usr/bin/npx --yes knowless-server --config-check
ExecStart=/usr/bin/npx --yes knowless-server
Restart=on-failure
RestartSec=2

# Hardening
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/knowless
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
LockPersonality=true
SystemCallArchitectures=native

[Install]
WantedBy=multi-user.target
```

Enable:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now knowless
sudo systemctl status knowless
sudo journalctl -u knowless -f
```

`ExecStartPre=knowless-server --config-check` ensures a misconfigured
deploy fails to start instead of silently breaking auth.

---

## 7. Reverse proxy — pick one

knowless does not terminate TLS. Your proxy fronts it on `:443`,
forwards `Host` and `X-Forwarded-For`, and (for forward-auth
deployments) routes protected upstreams through `/verify`.

### 7.1 Caddy

```caddy
auth.example.com {
    reverse_proxy 127.0.0.1:8080
}

# Protect Uptime Kuma with knowless forward-auth
kuma.example.com {
    forward_auth 127.0.0.1:8080 {
        uri /verify
        copy_headers X-Knowless-Handle
    }
    reverse_proxy 127.0.0.1:3001
}
```

Caddy auto-issues TLS via Let's Encrypt and trusts itself as a proxy
on the loopback. knowless's default `KNOWLESS_TRUSTED_PROXIES=127.0.0.1,::1`
covers this.

### 7.2 nginx

```nginx
# /etc/nginx/sites-available/auth.example.com
server {
    listen 443 ssl http2;
    server_name auth.example.com;
    # ssl_certificate / ssl_certificate_key managed by certbot

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# Protect a service with auth_request
server {
    listen 443 ssl http2;
    server_name kuma.example.com;

    location = /_knowless_verify {
        internal;
        proxy_pass http://127.0.0.1:8080/verify;
        proxy_pass_request_body off;
        proxy_set_header Content-Length "";
        proxy_set_header X-Original-URI $request_uri;
        proxy_set_header Cookie $http_cookie;
    }

    error_page 401 = @knowless_login;
    location @knowless_login {
        return 302 https://auth.example.com/login?next=https://$host$request_uri;
    }

    location / {
        auth_request /_knowless_verify;
        auth_request_set $handle $upstream_http_x_knowless_handle;
        proxy_set_header X-Knowless-Handle $handle;
        proxy_pass http://127.0.0.1:3001;
    }
}
```

### 7.3 Traefik

```yaml
# dynamic.yml
http:
  middlewares:
    knowless:
      forwardAuth:
        address: "http://127.0.0.1:8080/verify"
        authResponseHeaders: [ "X-Knowless-Handle" ]

  routers:
    auth:
      rule: "Host(`auth.example.com`)"
      service: knowless
      tls: { certResolver: le }
    kuma:
      rule: "Host(`kuma.example.com`)"
      service: kuma
      middlewares: [ knowless ]
      tls: { certResolver: le }

  services:
    knowless:
      loadBalancer:
        servers: [{ url: "http://127.0.0.1:8080" }]
    kuma:
      loadBalancer:
        servers: [{ url: "http://127.0.0.1:3001" }]
```

---

## 8. Tailscale / WireGuard pattern

A common deployment: knowless lives on a public VPS (port 25 open,
PTR set), but the services it protects live on a home server.
Connect them with a mesh VPN.

```
public VPS                      home server
+----------------+              +-------------------+
| Caddy :443     |              | Uptime Kuma :3001 |
| knowless :8080 |              | Vaultwarden :8222 |
| tailscale0     |--------------| tailscale0        |
+----------------+              +-------------------+
```

In Caddy on the VPS:

```caddy
kuma.example.com {
    forward_auth 127.0.0.1:8080 {
        uri /verify
    }
    reverse_proxy 100.64.0.5:3001   # tailscale IP of home server
}
```

Home server exposes nothing publicly. The VPS terminates TLS, runs
auth, and proxies through the mesh.

---

## 9. Reverse-proxy rate limiting (defence in depth)

knowless ships modest in-process limits as a baseline (FR-39).
Operators expecting elevated abuse should layer stricter limits at
the proxy. The proxy sees traffic earlier and can drop it without
even hitting Node.

### 9.1 Caddy

```caddy
auth.example.com {
    rate_limit {
        zone login_ip {
            key      {client_ip}
            window   1m
            events   10
        }
        match path /login
    }
    reverse_proxy 127.0.0.1:8080
}
```

(Requires the `caddy-ratelimit` plugin; build with
`xcaddy build --with github.com/mholt/caddy-ratelimit`.)

### 9.2 nginx

```nginx
limit_req_zone $binary_remote_addr zone=knowless_login:10m rate=10r/m;

server {
    location = /login {
        limit_req zone=knowless_login burst=5 nodelay;
        proxy_pass http://127.0.0.1:8080;
    }
}
```

---

## 10. fail2ban / Cloudflare Turnstile (heavier abuse profiles)

Optional; both have trade-offs.

**fail2ban** can tail `journalctl -u knowless` and block IPs that
trip many rate-limit responses:

```ini
# /etc/fail2ban/filter.d/knowless.conf
[Definition]
failregex = ^.*\s+\[knowless\]\s+rate-limited\s+ip=<HOST>
ignoreregex =
```

```ini
# /etc/fail2ban/jail.d/knowless.conf
[knowless]
enabled  = true
filter   = knowless
backend  = systemd
journalmatch = _SYSTEMD_UNIT=knowless.service
maxretry = 20
findtime = 600
bantime  = 3600
action   = iptables[name=knowless, port=https, protocol=tcp]
```

(knowless does not log structured rate-limit lines today; if you want
this you may need to wrap it. See Issue tracker.)

**Cloudflare Turnstile** is the lowest-friction CAPTCHA but
introduces a third-party dependency on Cloudflare for every login
form load. knowless doesn't integrate it natively; if you need it,
embed the widget in your own login page (use the library mode
`renderLoginForm` as a starting template).

Both are last-resort knobs. Most operators won't need them.

---

## 11. Operational checks

Once running:

```sh
# Validate config
sudo -u knowless npx --yes knowless-server --config-check

# Print effective config (secrets redacted)
sudo -u knowless npx --yes knowless-server --print-config

# Watch logs
sudo journalctl -u knowless -f

# Send yourself a magic link end-to-end
curl -i -X POST https://auth.example.com/login \
  -d email=you@somewhere-you-control.com
# Then check your inbox (NOT spam) for the link.
```

If the email lands in spam, work through §5 (SPF, DKIM, PTR, DMARC)
in that order — most spam-folder verdicts trace to one of those four.

---

## 12. Backup and recovery

The only stateful file is the SQLite database (`KNOWLESS_DB_PATH`,
default `/var/lib/knowless/knowless.db`). It contains:

- Handles (HMAC outputs of email addresses)
- Active token hashes (short-lived, 15 min default)
- Session ID hashes (30 day default)
- Rate-limit counters

Loss is recoverable: users sign in again and get a new session. There
is no irreplaceable data here. A weekly `sqlite3 knowless.db .backup`
is sufficient.

The HMAC secret in `/etc/knowless/knowless.env` is the actual asset
to protect. Losing it logs every user out and changes every handle
(emails will be re-derived to new opaque values on next login).
**Back up the secret separately, out-of-band, encrypted.** Never
commit it.

---

## 13. Where things are documented

- **PRD** (`docs/01-product/PRD.md`) — what the library does and
  doesn't do, threat model, NO-GO list
- **SPEC** (`docs/02-design/SPEC.md`) — wire formats, exact flows,
  schema
- **GUIDE.md** — application-developer integration in library mode
- **README.md** — short orientation
- **OPS.md** (this document) — operator-side setup
