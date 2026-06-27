# Mittwald Deployment (mStudio Container Hosting)

Diese Anleitung richtet einen reproduzierbaren Deployment-Prozess fuer `METAorder-v2` auf **Mittwald mStudio** ein:

1. Image in **GHCR** bauen und pushen
2. Stack einmalig per **mw CLI** deployen
3. Updates automatisch via **GitHub Actions** ausrollen
4. Bei Bedarf per SHA-Tag zurueckrollen

## 1) Voraussetzungen

- GitHub-Repo: `about-design/META-Order-v3`
- Container-Registry: **GHCR** `ghcr.io/about-design/metaorder-v2`
- Mittwald **mStudio** mit Container-Hosting
- Mittwald **mw CLI** ([Dokumentation](https://developer.mittwald.de/docs/v2/cli/))
- Externe PostgreSQL-DB (Mittwald Managed DB empfohlen)
- Persistentes Volume fuer `/app/uploads`

## 2) Einmaliges Setup

### 2.1 mw CLI und API-Token

```bash
# CLI installieren (siehe Mittwald-Doku), dann:
mw login
# oder: export MITTWALD_API_TOKEN=<token>
```

API-Token in mStudio unter **Benutzer → API-Tokens** anlegen.

### 2.2 GitHub Secrets (Repository Settings → Secrets and variables → Actions)

| Secret | Beschreibung |
|--------|--------------|
| `MITTWALD_API_TOKEN` | mStudio API-Token |
| `MITTWALD_PROJECT_ID` | Projekt-ID oder Short-ID |
| `MITTWALD_CONTAINER_ID` | Container-ID oder Short-ID (nach Erst-Deploy) |

IDs ermitteln:

```bash
mw project list
mw container list --project-id <PROJECT_ID>
```

### 2.3 GHCR-Zugriff fuer Mittwald

Mittwald muss Images aus GHCR pullen koennen:

- **Option A (einfach):** GHCR-Package `metaorder-v2` auf **public** stellen (GitHub → Packages → Package settings → Change visibility).
- **Option B (privat):** Registry-Credentials im mStudio-Stack hinterlegen (GitHub PAT mit `read:packages`).

### 2.4 app.env vorbereiten

```bash
cd METAorder-v2
cp deploy/mittwald/app.env.example deploy/mittwald/app.env
# Werte anpassen: DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY, PUBLIC_APP_URL, ...
```

Pflichtwerte in `app.env`:

- `DATABASE_URL` — Mittwald Postgres (Host z. B. `meta-db-uvclwb`)
- `SESSION_SECRET` — langer Zufallswert
- `ENCRYPTION_KEY` — langer Zufallswert
- `PUBLIC_APP_URL` — oeffentliche App-URL

Optional: `S3_*`, `COMMERCIAL_AGENT_*`, Integrations-Variablen (siehe `app.env.example`).

### 2.5 Erstes Image bauen und pushen

Lokal (einmalig, vor Erst-Deploy):

```bash
cd METAorder-v2
echo "$GITHUB_TOKEN" | docker login ghcr.io -u USERNAME --password-stdin
scripts/release-image.sh ghcr.io/about-design/metaorder-v2
```

Alternativ: einmal `main` pushen und GitHub Actions bauen lassen (Secrets fuer Deploy koennen danach gesetzt werden).

### 2.6 Stack in mStudio deployen

```bash
cd METAorder-v2
mw stack deploy \
  -f deploy/mittwald/docker-compose.mittwald.yml \
  --env-file deploy/mittwald/app.env \
  --project-id <PROJECT_ID>
```

Danach in mStudio pruefen/konfigurieren:

- **Volume** `metaorder_uploads` → `/app/uploads` (in Compose bereits definiert)
- **Domain/Ingress** auf Container-Port **5000**
- Container-ID notieren fuer GitHub Secret `MITTWALD_CONTAINER_ID`

SQL-Migrationen laufen beim Containerstart automatisch (`scripts/docker-entrypoint.sh` → `run-migrations.mjs`).

Bei leerer DB einmalig Basistabellen anlegen:

```bash
DATABASE_URL="postgresql://..." npm run db:push
```

## 3) Kontinuierliche Updates (GitHub Actions)

Workflow: [`.github/workflows/deploy-mittwald.yml`](../../.github/workflows/deploy-mittwald.yml)

**Trigger:** Push auf `main` mit Aenderungen unter `METAorder-v2/**`

**Ablauf:**

1. Docker-Image bauen (`linux/amd64`)
2. Push nach GHCR als `:<git-sha>` und `:latest`
3. `mw container update --image ... --recreate` auf Mittwald

Solange die Mittwald-Secrets fehlen, baut der Workflow trotzdem das Image — der Deploy-Schritt wird uebersprungen.

## 4) Manuelles Deploy / Rollback

### Per GitHub Actions (empfohlen)

**Neues Image bauen und deployen:** Actions → *Deploy METAorder-v2 to Mittwald* → Run workflow

**Rollback auf bestehenden Tag (ohne Build):**

- `deploy_only`: **true**
- `image_tag`: z. B. `abc1234` (stabiler Git-SHA)

### Per mw CLI lokal

```bash
cd METAorder-v2
export MITTWALD_PROJECT_ID=<PROJECT_ID>
export MITTWALD_CONTAINER_ID=<CONTAINER_ID>

scripts/mittwald-rollout.sh ghcr.io/about-design/metaorder-v2:<SHA>
```

Optional oeffentlichen Healthcheck:

```bash
export HEALTHCHECK_URL=https://metaorder.example.de/healthz
scripts/mittwald-rollout.sh ghcr.io/about-design/metaorder-v2:<SHA>
```

Bei Fehler Rollback mit explizitem vorherigem Tag:

```bash
export PREVIOUS_IMAGE=ghcr.io/about-design/metaorder-v2:<ALTER_SHA>
export HEALTHCHECK_URL=https://metaorder.example.de/healthz
scripts/mittwald-rollout.sh ghcr.io/about-design/metaorder-v2:<NEUER_SHA>
```

## 5) Lokaler Image-Release (ohne CI)

```bash
cd METAorder-v2
scripts/release-image.sh ghcr.io/about-design/metaorder-v2
# Optional festen Tag:
scripts/release-image.sh ghcr.io/about-design/metaorder-v2 abc1234
```

## 6) Betriebshinweise

- Healthcheck-Route: `GET /healthz`
- Compose-Setup betreibt nur die App; DB bleibt getrennt (Managed Postgres)
- Uploads persistent in Volume `metaorder_uploads`
- Backups sicherstellen fuer:
  - Datenbank
  - Upload-Volume (`/app/uploads`)

## 7) Legacy

[`scripts/mittwald-deploy.sh`](../scripts/mittwald-deploy.sh) ist **deprecated** (SSH + `docker compose`). Fuer mStudio immer [`scripts/mittwald-rollout.sh`](../scripts/mittwald-rollout.sh) oder GitHub Actions verwenden.

## Referenzen

- [Mittwald Container-Doku](https://developer.mittwald.de/docs/v2/platform/workloads/containers/)
- [mw stack deploy](https://developer.mittwald.de/docs/v2/cli/reference/stack/)
- [Docker-Setup lokal](docker.md)
