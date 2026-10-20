# Hosting Jack Vault on jackvault777.com

Jack Vault runs on [Railway](https://railway.com) as one service plus a PostgreSQL database. The domain stays at Namecheap; only its DNS records point at Railway.

```
 player / agent browser
        │  https://jackvault777.com
        ▼
 Railway edge (HTTPS certificate, automatic)
        │
        ▼
 jack-vault service (deploy/railway/Dockerfile)
   Caddy on $PORT ── /            player client (client/dist)
                 └── /api /ws /office ──► game server on 127.0.0.1:8081
        │
        ▼
 Railway PostgreSQL (daily / weekly / monthly backups)
```

## Why Railway

- **Allowed content.** Railway's [terms](https://railway.com/legal/terms) and [acceptable use policy](https://railway.com/legal/acceptable-use) don't ban gaming or sweepstakes sites. Like every host, they ban anything illegal where you operate. Render and DigitalOcean read the same way, so the legal check below matters more than which host you pick.
- **Namecheap root domain works.** Railway supports a CNAME on the bare domain (`jackvault777.com`) at Namecheap, so no nameserver change is needed.
- **HTTPS, deploys and backups are built in.** Merging to `main` redeploys. Postgres backups are a toggle on the Pro plan.

**Cost:** the Pro plan is $20/month and includes $20 of usage, which covers this app at launch size. The Hobby plan ($5/month) also runs it, but has no automatic database backups, so use Pro once real coins are involved.

## What the repo provides

| File | Role |
|---|---|
| `railway.json` | Tells Railway to build `deploy/railway/Dockerfile`, restart on any exit, and stop the old copy before the new one takes over. |
| `deploy/railway/Dockerfile` | Builds the player client and the server into one image. Sets `NODE_ENV=production`, which turns off the `demo-distributor` account. |
| `deploy/railway/Caddyfile` | Serves the client, proxies `/api`, `/ws` and `/office` to the server, redirects `www.` to the bare domain, adds HSTS and caching headers. |
| `deploy/railway/start.sh` | Runs Caddy and the server. If the server exits (a crash, or the previous deploy still holding the database lock), it restarts it after 3 seconds. |

`docker compose up --build` is unchanged and still the local stack.

## Setup

### 1. Railway account

1. Go to [railway.com](https://railway.com) and sign in with GitHub (the `cliftonciangg` account).
2. Allow Railway to see the `jack-vault` repository when GitHub asks.
3. Under **Account → Plans**, choose **Pro** and add a card.

### 2. Project and database

1. **New Project → Deploy from GitHub repo → jack-vault.** Railway finds `railway.json` and starts a build. The first deploy fails or waits until the database exists; that's expected.
2. In the project, **+ Create → Database → PostgreSQL**.

### 3. Variables

Open the **jack-vault** service → **Variables** and add:

| Name | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Railway fills it in; it uses the private network) |
| `ADMIN_KEY` | A long random string, 40+ characters. Keep it private. It unlocks `/api/admin`. |
| `SEED_DISTRIBUTOR` | `yourname:a-long-password` for the first owner/distributor account. Remove it after the first login. |
| `MATH_PROFILE` | `rtp95` (or `rtp94` / `rtp96`) |

To make a random `ADMIN_KEY` on Windows, run this in PowerShell and paste the result:

```powershell
-join ((48..57)+(65..90)+(97..122) | Get-Random -Count 48 | % {[char]$_})
```

Leave `NODE_ENV` alone (the image sets `production`), and leave `ALLOW_PLAYER_CREATE` unset so only agent-made player accounts can log in. `CORS_ORIGIN` isn't needed because the client and API share one domain.

Saving the variables redeploys. When the log shows `Jack Vault server on :8081`, it's up.

### 4. Domain

1. **jack-vault service → Settings → Networking → Custom Domain**, enter `jackvault777.com`, port **8080**. Then add `www.jackvault777.com` the same way.
2. Railway shows a **CNAME** and a **TXT** record for each. Keep that page open.
3. In Namecheap: **Domain List → jackvault777.com → Manage → Advanced DNS**.
4. Delete the parking records Namecheap added (usually a `CNAME www → parkingpage.namecheap.com` and a `URL Redirect @`).
5. **Add New Record** for each record Railway shows. In Namecheap's **Host** box, type only the part before `.jackvault777.com`:
   - `CNAME` Host `@`, Value: the target Railway shows for `jackvault777.com`
   - `CNAME` Host `www`, Value: the target Railway shows for `www.jackvault777.com`
   - `TXT` records: Host and Value exactly as Railway shows them (drop the `.jackvault777.com` ending from the Host)
   - TTL: Automatic
6. Wait for both domains to show a green check in Railway (usually minutes, up to a day). Railway then issues the HTTPS certificates on its own.

### 5. First login

1. Open `https://jackvault777.com/office` and log in with the `SEED_DISTRIBUTOR` username and password.
2. Delete the `SEED_DISTRIBUTOR` variable in Railway. The account stays; the variable only creates it when missing.
3. Create agents, load them, and have agents create players. Players play at `https://jackvault777.com`.

### 6. Backups

1. Open the **Postgres** service → **Backups** tab.
2. Turn on **Daily**, **Weekly** and **Monthly**. Railway keeps them 6, 27 and 89 days.
3. To restore, pick a backup there and restore it, then redeploy the jack-vault service so it reloads from the database.

For a copy outside Railway, enable the Postgres service's public network (Settings → Networking → TCP proxy) only while you need it, and run `pg_dump "<DATABASE_PUBLIC_URL>" -Fc -f jackvault.dump` with PostgreSQL client tools installed. Store the file somewhere private: it holds every account, balance and password hash.

## Day to day

- **Deploys.** Each merge to `main` builds and deploys. The old copy stops, then the new one takes the database lock, so the game is unavailable for roughly 5–15 seconds. Deploy at quiet hours. A player who opens the site in exactly that window sees the offline demo; refreshing fixes it.
- **One instance only.** Keep the service at 1 replica. The server refuses to share a database, and a second replica would just sit retrying.
- **Logs.** jack-vault service → Deployments → View logs.
- **Rotating the admin key.** Change `ADMIN_KEY` in Variables; it redeploys.

## Before taking real money

- **Legal.** Buying coins from agents and redeeming them for value is regulated as gambling or sweepstakes in most places, and several US states have banned online sweepstakes casinos outright. Get advice for each place you'll operate before launch. No host allows illegal gambling, and a host can suspend a site after a complaint.
- **Repository visibility.** The GitHub repository is public. Consider making it private (GitHub → Settings → Danger Zone → Change visibility). Railway keeps deploying from it.
- **Payments.** Card processors have their own rules for gaming and sweepstakes, separate from the host's.
