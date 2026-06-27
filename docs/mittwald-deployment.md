# Mittwald Deployment (mStudio Container Hosting)

Diese Anleitung richtet einen reproduzierbaren Deployment-Prozess fuer `METAorder-v2` auf **Mittwald mStudio** ein:

1. Image in **GHCR** bauen und pushen
2. Stack per **mittwald/deploy-container-action** aus [`stack.yaml`](../deploy/mittwald/stack.yaml) deployen
3. Updates automatisch via **GitHub Actions** bei Push auf `main`
4. Rollback per festem Image-Tag (SHA)

## 1) Voraussetzungen

- GitHub-Repo: **`META-Regalbau/METAorder-v2`** (Workflow + Secrets hier)
- Container-Registry: **GHCR** `ghcr.io/meta-regalbau/metaorder-v2`
- Mittwald-Projekt: **`p-bbpye5`** (Domain: `p-bbpye5.project.space`)
- Stack-Definition: [`deploy/mittwald/stack.yaml`](../deploy/mittwald/stack.yaml)

## 2) GitHub Secrets und Variables

### Secrets (Repository **META-Regalbau/METAorder-v2** → Settings → Secrets and variables → Actions)

> **Haeufigster Fehler:** Secrets im falschen Repo (`about-design/META-Order-v3`) oder als **Organization Secret** ohne Zugriff fuer dieses Repo.

| Secret | Pflicht | Beschreibung |
|--------|---------|--------------|
| `MITTWALD_API_TOKEN` | ja | mStudio API-Token |
| `MITTWALD_STACK_ID` | ja* | Stack-UUID (alternativ als **Variable** moeglich) |
| `DATABASE_URL` | ja | PostgreSQL Connection String (siehe unten) |
| `SESSION_SECRET` | ja | Session-Verschluesselung |
| `ENCRYPTION_KEY` | ja | App-Verschluesselung |
| `METAORDER_INTEGRATION_API_KEY` | nein | Integration API |
| `S3_*` | nein | S3/MinIO fuer Ticket-Anhaenge |

### Variables (optional, nicht-geheim)

| Variable | Empfohlen fuer Projekt `p-bbpye5` |
|----------|-----------------------------------|
| `PUBLIC_APP_URL` | `https://p-bbpye5.project.space` |
| `REQUEST_LOG_SLOW_MS` | `1500` |
| `METAORDER_STRICT_TENANT` | `true` |
| `S3_REGION` | `us-east-1` |
| `COMMERCIAL_AGENT_ENABLED` | `true` |
| `AI_MODE` | `openai_optional` |

### Zielprojekt Mittwald

| Feld | Wert |
|------|------|
| Projekt-Short-ID | `p-bbpye5` |
| Stack-ID | `a86b11e2-5ea0-4777-a252-89d9a172c2c5` → GitHub Secret `MITTWALD_STACK_ID` |
| Projekt-Domain | `p-bbpye5.project.space` |
| Container-Port (App) | `5000` |

**Stack-ID in GitHub eintragen:**

Repository **META-Regalbau/METAorder-v2** → Settings → Secrets → `MITTWALD_STACK_ID` = `a86b11e2-5ea0-4777-a252-89d9a172c2c5`

**Ingress / Domain:** In mStudio den Container-Port **5000** auf die gewuenschte Domain routen (z. B. `p-bbpye5.project.space` oder eigene Domain).

### DATABASE_URL (GitHub Secret)

**Nicht** den SSH-Host (`ssh.altgemeinde.project.host`) in `DATABASE_URL` verwenden — der ist nur fuer Shell-Zugang, nicht fuer PostgreSQL aus dem Container.

Verbindungsdaten holen:

1. mStudio → Projekt mit der **PostgreSQL-Datenbank** → **Datenbanken** → PostgreSQL
2. Benutzer, Passwort, Datenbankname und **Datenbank-Host** aus dem Panel kopieren

**Format fuer GitHub Secret `DATABASE_URL`:**

```
postgresql://BENUTZER:PASSWORT@HOST:5432/DATENBANKNAME
```

**Typische Mittwald-Faelle:**

| Situation | Host in DATABASE_URL |
|-----------|----------------------|
| Managed PostgreSQL **im gleichen Projekt** wie der Container (`p-bbpye5`) | oft `postgresql` (Port `5432`) |
| Host laut mStudio-Datenbankpanel | exakt diesen Host eintragen |
| DB in anderem Projekt (`altgemeinde`) als Container (`p-bbpye5`) | Host aus DB-Panel; ggf. gleiches Projekt noetig oder Freigabe pruefen |

### Projekt **altgemeinde** (DB) + **p-bbpye5** (App)

Aktuelles Setup: PostgreSQL in **altgemeinde**, METAorder-Container in **p-bbpye5**.

Mittwald isoliert Projekte im Netz — der Hostname **`postgresql`** gilt **nur innerhalb desselben Projekts**. Der Container in `p-bbpye5` erreicht die DB in `altgemeinde` **nicht** ueber `@postgresql:5432`.

**Empfohlene Loesungen (eine waehlen):**

| Option | Beschreibung |
|--------|----------------|
| **A (empfohlen)** | METAorder-Stack nach **altgemeinde** deployen (gleiches Projekt wie DB). `MITTWALD_STACK_ID`, Registry-Credentials und Domain/Ingress in altgemeinde anpassen. `DATABASE_URL`: `postgresql://USER:PASS@postgresql:5432/DBNAME` |
| **B** | PostgreSQL (mit **pgvector**) nach **p-bbpye5** verlegen oder neu anlegen; Dump aus altgemeinde importieren |
| **C** | Nicht empfohlen: DB oeffentlich exponieren — Sicherheitsrisiko |

`ssh.altgemeinde.project.host` ist **nur SSH**, nicht der PostgreSQL-Host fuer `DATABASE_URL`.

**Schema/Data auf altgemeinde einspielen (vom Mac):**

```bash
# mStudio-CLI im Projekt altgemeinde (Projekt-ID aus URL oder mw project list)
mw container port-forward postgresql 5433:5432 --project-id <ALTGEMEINDE_PROJECT_ID>

export DATABASE_URL="postgresql://USER:PASS@127.0.0.1:5433/DBNAME"
cd METAorder-v2 && npm install && npm run db:push && npm run db:migrate
```

Container-Name (`postgresql`) ggf. in mStudio → altgemeinde → Container pruefen.

**Wenn die App in p-bbpye5 bleibt:** GitHub Secret `DATABASE_URL` mit `@postgresql:5432` **funktioniert nicht** — zuerst Option A oder B umsetzen.

Sonderzeichen im Passwort URL-encoden (z. B. `@` → `%40`).

Ohne gueltiges `DATABASE_URL` ueberspringt oder bricht der Deploy ab — der Container startet dann nicht sauber in mStudio.

## 3) GHCR-Zugriff fuer Mittwald

Fehler **`registry credentials have no image access`** bedeutet: mStudio darf `ghcr.io/meta-regalbau/metaorder-v2` nicht pullen (fehlende, falsche oder unzureichende Registry-Anmeldung).

Image-Ziel: **`ghcr.io/meta-regalbau/metaorder-v2:latest`** (bzw. `:<git-sha>`)

### Option A — Package oeffentlich (schnellster Weg)

1. GitHub → Organisation **META-Regalbau** → **Packages** → **`metaorder-v2`**
2. **Package settings** → **Change visibility** → **Public**
3. Deploy-Workflow erneut starten

Oeffentliche Images brauchen **keine** Registry-Credentials in mStudio.

### Option B — Private Registry in mStudio (empfohlen fuer Produktion)

#### 1) GitHub PAT (classic)

1. GitHub → **Settings** → **Developer settings** → **Personal access tokens** → **Tokens (classic)**
2. **Generate new token (classic)**
3. Name z. B. `mStudio GHCR pull`
4. Scopes:
   - **`read:packages`** (Pflicht)
   - **`repo`** zusaetzlich, wenn das Repo **privat** ist und das Package daran haengt
5. Token erzeugen und kopieren
6. Organisation **META-Regalbau** mit SSO: neben dem Token **Configure SSO** → Organisation autorisieren (sonst: Login ok, Pull verweigert)

#### 2) Registry im Mittwald-Projekt `p-bbpye5`

mStudio → Projekt **p-bbpye5** → **Container** → **Registry credentials** / **Registries** (Bezeichnung je nach UI):

| Feld | Wert |
|------|------|
| Registry / URL | `ghcr.io` |
| Benutzername | **Dein GitHub-Benutzername** (Besitzer des PAT — **nicht** `meta-regalbau`) |
| Passwort / Token | der PAT aus Schritt 1 |

Speichern, dann Deploy erneut starten.

#### 3) Typische Fehler bei `no image access`

| Problem | Loesung |
|---------|---------|
| Falscher Benutzername (`meta-regalbau` statt GitHub-User) | GitHub-Username des PAT-Inhabers eintragen |
| Nur `read:packages`, Repo privat | zusaetzlich Scope **`repo`** |
| Org-SSO aktiv | Token fuer **META-Regalbau** autorisieren |
| PAT-Inhaber kein Zugriff auf Org-Package | GitHub-User muss Leserecht auf Package/Repo haben |
| Credentials in falschem Projekt | Registry in **p-bbpye5** hinterlegen, nicht in altgemeinde |
| Package existiert nicht | Actions-Job *Build and push* muss erfolgreich sein; unter Packages sichtbar? |

#### 4) Kurztest (optional, lokal)

```bash
echo "$GITHUB_PAT" | docker login ghcr.io -u DEIN_GITHUB_USER --password-stdin
docker pull ghcr.io/meta-regalbau/metaorder-v2:latest
```

Wenn `docker pull` lokal scheitert, hilft auch mStudio nicht — erst PAT/Rechte/Visibility fixen.

## 4) Stack-Dateien

| Datei | Zweck |
|-------|--------|
| [`stack.yaml`](../deploy/mittwald/stack.yaml) | **Quelle fuer CI** — mStudio Stack (Action `deploy-container-action`) |
| [`docker-compose.mittwald.yml`](../deploy/mittwald/docker-compose.mittwald.yml) | Referenz / manuelles `mw stack deploy` lokal |
| [`app.env.example`](../deploy/mittwald/app.env.example) | Vorlage fuer lokales Erst-Setup |

> **Wichtig:** Die Action ueberschreibt den Stack komplett gemaess `stack.yaml`. Manuelle Aenderungen in mStudio, die nicht im Repo stehen, gehen beim Deploy verloren.

## 5) Automatischer Ablauf (GitHub Actions)

Workflow: [`.github/workflows/deploy-mittwald.yml`](../.github/workflows/deploy-mittwald.yml) im Repo **META-Regalbau/METAorder-v2**

```mermaid
flowchart LR
  push["Push main"] --> build["Build + Push GHCR"]
  build --> action["mittwald/deploy-container-action"]
  action --> stack["UpdateStack aus stack.yaml"]
  stack --> recreate["Service recreate metaorder-app"]
```

Bei Push auf `main` (Aenderungen unter `METAorder-v2/**`):

1. Docker-Image bauen → GHCR `:<sha>` + `:latest`
2. `mittwald/deploy-container-action@v1` mit `stack.yaml` und Secrets
3. Stack-Update inkl. neues Image, Env-Vars, Volume, Port 5000

Ohne Mittwald-/App-Secrets schlaegt der Deploy-Job fehl und listet **welche** Werte fehlen (Schritt *Check Mittwald configuration*).

### Deploy scheitert mit registry credentials have no image access

→ Abschnitt **3) GHCR-Zugriff fuer Mittwald** (Package public oder PAT in mStudio Projekt `p-bbpye5`).

### Deploy wird uebersprungen / schlaegt fehl

1. Secrets in **`META-Regalbau/METAorder-v2`** pruefen (nicht im Parent-Repo)
2. Exakte Namen: `MITTWALD_API_TOKEN`, `MITTWALD_STACK_ID`, `DATABASE_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`
3. `MITTWALD_STACK_ID` darf auch unter **Variables** stehen: `a86b11e2-5ea0-4777-a252-89d9a172c2c5`
4. Organization Secrets: Repo **META-Regalbau/METAorder-v2** muss Zugriff haben
5. Workflow erneut starten und Log *Check Mittwald configuration* lesen

## 6) Rollback

GitHub Actions → *Deploy METAorder-v2 to Mittwald* → Run workflow:

- `deploy_only`: **true**
- `image_tag`: stabiler Git-SHA (z. B. `abc1234`)

## 7) Lokales Erst-Setup (optional)

Falls der Stack noch nicht existiert (Projekt **p-bbpye5**):

```bash
cd METAorder-v2
cp deploy/mittwald/app.env.example deploy/mittwald/app.env
# DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY anpassen

mw stack deploy \
  -f deploy/mittwald/docker-compose.mittwald.yml \
  --env-file deploy/mittwald/app.env \
  --project-id p-bbpye5
```

Danach `MITTWALD_STACK_ID` in GitHub Secrets eintragen. Weitere Deploys laufen ueber GitHub Actions.

## 8) Betriebshinweise

- Healthcheck in der App: `GET /healthz`
- Uploads persistent: Volume `metaorder_uploads` → `/app/uploads`
- SQL-Migrationen beim Containerstart (`scripts/docker-entrypoint.sh`)
- Backups: Datenbank + Upload-Volume

## 9) Datenbank einrichten (nur Container)

Ab dem naechsten Image-Deploy erledigt der Container **automatisch**:

1. `CREATE EXTENSION vector`
2. Drizzle-Schema (`drizzle-kit push`) — nur wenn Tabelle `tenants` noch fehlt
3. SQL-Dateien unter `migrations/`

### Dein einziger Schritt

1. **GitHub Secret `DATABASE_URL`** setzen (Passwort URL-encoden):

   ```
   postgresql://oliver-steiling:PASSWORT@pgvector:5432/MetaPGDB
   ```

   Gueltig nur wenn **App-Container und PostgreSQL im gleichen Mittwald-Projekt**. Host = **Stack-Service-Name** aus mStudio (bei euch: **`pgvector`**, nicht `postgresql`).

2. **Neues Image deployen** (Push auf `main` oder Workflow starten) **oder** Container in mStudio **neu starten** (Recreate).

3. Logs pruefen — erwartete Zeilen:

   ```
   [container-db-init] Step 1/3: pgvector
   [container-db-init] Step 2/3: Drizzle schema push
   [container-db-init] Step 3/3: SQL migrationen
   [container-db-init] Fertig.
   ```

### Manuell (optional, ohne Neustart)

Im Projekt mit dem **metaorder-app**-Container:

```bash
mw container exec metaorder-app /app/scripts/mittwald-db-init.sh
```

Oder:

```bash
mw container exec metaorder-app node scripts/container-db-init.mjs
```

**App in p-bbpye5, DB in altgemeinde**

`@postgresql:5432` funktioniert **nicht** ueber **Projekt**grenzen hinweg.

**Gleiches Projekt, verschiedene Container** (z. B. `metaorder-app` + Postgres `postgresql`) ist **korrekt** — interner Host:

```
postgresql://oliver-steiling:PASSWORT@postgresql:5432/MetaPGDB
```

Host **`pgvector`** = Postgres/pgvector-Container im Stack (Service-Name in mStudio pruefen).

### Lokaler Fallback (nur wenn Container-Init nicht moeglich)

Port-Forward in **altgemeinde**, dann vom Mac:

```bash
mw container port-forward postgresql 5433:5432
export DATABASE_URL="postgresql://oliver-steiling:PASS@127.0.0.1:5433/MetaPGDB"
npm run db:init:container
```

### Datenimport (bestehende Instanz)

Dump von lokal → Restore ueber Port-Forward (siehe fruehere `pg_dump` / `pg_restore`-Beispiele). **`ENCRYPTION_KEY`** muss zur Quell-DB passen.

### Typische Fehler

| Symptom | Ursache | Loesung |
|---------|---------|---------|
| `relation "tenants" does not exist` | Altes Image ohne `container-db-init` | Neues Image deployen + Recreate |
| `type "vector" does not exist` | pgvector fehlt auf Postgres | pgvector-Image / Extension |
| `getaddrinfo ENOTFOUND postgresql` | falscher DB-Host in DATABASE_URL | Host auf Stack-Namen setzen (z. B. `pgvector`) |
| Connection refused `@pgvector` | App und DB in verschiedenen Projekten | gleiches Projekt oder Host anpassen |
| Shopware-Keys leer nach Import | anderer `ENCRYPTION_KEY` | Key aus Quell-Umgebung uebernehmen |


## Referenzen

- [mittwald/deploy-container-action](https://github.com/mittwald/deploy-container-action)
- [Mittwald Container Actions Guide](https://developer.mittwald.de/docs/v2/guides/deployment/container-actions/)
- [Docker-Setup lokal](docker.md)
