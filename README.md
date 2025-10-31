# Bookshop Demo

Bookshop is a virtual online bookstore application through which you can find books of various categories and rate the books.

You can perform CRUD operations such as viewing book details, adding and deleting ratings, editing book inventory, etc.

> Powered by TiDB Cloud, Prisma and Vercel.

## 🔥 Visit Live Demo

[👉 Click here to visit](https://tidb-prisma-vercel-demo.vercel.app/)

![image](https://github.com/pingcap/tidb-prisma-vercel-demo/assets/56986964/2ef5fd7f-9023-45f4-b639-f4ba4ddec157)

## Deploy on Vercel

## 🧑‍🍳 Before We Start

Create a [TiDB Cloud](https://tidbcloud.com/) account and get your free trial cluster.

### 🚀 One Click Deploy

You can click the button to quickly deploy this demo if already has an TiDB Cloud cluster.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?demo-title=TiDB%20Cloud%20Starter&demo-description=A%20bookstore%20demo%20built%20on%20TiDB%20Cloud%20and%20Next.js.&demo-url=https%3A%2F%2Ftidb-prisma-vercel-demo.vercel.app%2F&demo-image=%2F%2Fimages.ctfassets.net%2Fe5382hct74si%2F2HMASOQn8hQit2IFi2hK3j%2Fcfe7cc2aeba4b8f6760a3ea14c32f707%2Fscreenshot-20220902-160324_-_Chen_Zhen.png&project-name=TiDB%20Cloud%20Starter&repository-name=tidb-cloud-starter&repository-url=https%3A%2F%2Fgithub.com%2Fpingcap%2Ftidb-prisma-vercel-demo&from=templates&integration-ids=oac_coKBVWCXNjJnCEth1zzKoF1j)

> Integration will guide you connect your TiDB Cloud cluster to Vercel.

<details>
  <summary><h3>Manually Deploy (Not recommended)</h3></summary>

#### 1. Get connection details

You can get the connection details by clicking the `Connect` button.

![image](https://github.com/pingcap/tidb-prisma-vercel-demo/assets/56986964/86e5df8d-0d61-49ca-a1a8-d53f2a3f618c)

Get `User` and `Host` field from the dialog.

> Note: For importing initial data from local, you can set an Allow All traffic filter here by entering an IP address of `0.0.0.0/0`.

![image](https://github.com/pingcap/tidb-prisma-vercel-demo/assets/56986964/8d32ed58-4edb-412f-8af8-0e1303cceed9)

Your `DATABASE_URL` should look like `mysql://<User>:<Password>@<Host>:4000/bookshop`

#### 2. Deploy on Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fpingcap%2Ftidb-prisma-vercel-demo&repository-name=tidb-prisma-vercel-demo&env=DATABASE_URL&envDescription=TiDB%20Cloud%20connection%20string&envLink=https%3A%2F%2Fdocs.pingcap.com%2Ftidb%2Fdev%2Fdev-guide-build-cluster-in-cloud&project-name=tidb-prisma-vercel-demo)

![image](https://user-images.githubusercontent.com/56986964/199161016-2d236629-bb6a-4e3c-a700-c0876523ca6a.png)

</details>

## Deploy on AWS Linux

### Install git and nodejs pkgs

```bash
sudo yum install -y git

# Ref: https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/setting-up-node-on-ec2-instance.html
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash;
source ~/.bashrc;
nvm install --lts;
node -e "console.log('Running Node.js ' + process.version)"
```

### Clone the repository

```bash
git clone https://github.com/pingcap/tidb-prisma-vercel-demo.git;
cd tidb-prisma-vercel-demo;
```

### Install dependencies

```bash
corepack enable;
corepack yarn install;
yarn;
```

### Connect to TiDB Cloud and create a database

```bash
mysql -h gateway01.us-west-2.prod.aws.tidbcloud.com -P 4000 -u user -p
```

```
mysql> create database tidb_labs_bookshop;
```

### Set environment variables

```bash
export DATABASE_URL=mysql://user:pass@gateway01.us-west-2.prod.aws.tidbcloud.com:4000/tidb_labs_bookshop
```

### Connectivity environment variables

This starter now exposes smoke-test endpoints that require additional environment
variables. **Never commit credentials to Git.** Configure them in your runtime
environment (for example, Vercel project settings or a local `.env.local` that
remains untracked).

| Integration | Variables | Notes |
| --- | --- | --- |
| Cloudflare Images | `CF_IMAGES_ENABLED`, `CF_IMAGES_ACCOUNT_ID`, `CF_IMAGES_TOKEN`, `CF_IMAGES_BASE_URL` | When `CF_IMAGES_ENABLED` is not truthy or any other field is missing, the integration is skipped to avoid accidental calls. |
| Cloudflare Cache & Purge | `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ENABLE_PURGE_ON_PUBLISH` (optional), `CLOUDFLARE_INCLUDE_PRODUCT_URLS` (optional), `NEXT_PUBLIC_SITE_URL` (fallback origin) | Zone ID and token are mandatory for any purge action. Toggles default to `false`. |
| TiDB (Prisma) | `TIDB_HOST`, `TIDB_PORT`, `TIDB_USER`, `TIDB_PASSWORD`, `TIDB_DATABASE`, optional `TIDB_SSL_MODE`, `TIDB_SSL_CA`, `TIDB_SSL_SERVER_NAME`, `TIDB_PRODUCTS_TABLE`, `TIDB_PRODUCTS_LASTMOD_COLUMN`, `TIDB_PRODUCTS_PUBLISHED_WHERE` | TLS defaults to `skip-verify`. Embedded certificates support `\n` literals or Base64. Product metrics default to the `products` table and `updated_at` column but can be overridden when schemas differ. |
| Algolia | `ALGOLIA_APP_ID`, `ALGOLIA_ADMIN_API_KEY` (or `ALGOLIA_API_KEY`), `ALGOLIA_INDEX_PRIMARY` (or `ALGOLIA_INDEX`) | Admin keys stay server-side only. |
| Admin dashboard | `ADMIN_PASSWORD` | Basic Auth password for `/admin` (username fixed to `admin`). Required to enable protected routes. |

### Connectivity smoke tests

After configuring the variables above you can trigger internal health checks:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/api/admin/connectivity/cloudflare/test` | `GET` | Validates Cloudflare Images credentials. |
| `/api/admin/connectivity/cloudflare/purge-sitemaps` | `POST` | Purges sitemap URLs (and optionally product pages) using Cloudflare Cache APIs. |
| `/api/admin/connectivity/cloudflare/purge-last-batch` | `POST` | Replays the most recent sitemap/product purge batch for troubleshooting. |
| `/api/admin/connectivity/cloudflare/purge-everything` | `POST` | Issues a `purge_everything` command to Cloudflare with guarded retries. |
| `/api/admin/connectivity/tidb` | `GET` | Runs `SELECT 1` and basic publication counts against TiDB. |
| `/api/admin/connectivity/algolia` | `POST` | Confirms the target Algolia index exists and records latency. |
| `/api/admin/connectivity/revalidate-sitemap` | `POST` | Fetches the public sitemap to verify CDN revalidation and domain resolution. |

Each endpoint logs structured results (without exposing secrets) so you can
verify latency, `cf-ray` identifiers, and standardized error codes before the
UI layer is implemented.

### Admin dashboard

- Visit `/admin` after deploying credentials above to access the Connectivity
  tab. The area is protected via Basic Auth using the fixed username `admin`
  and the password stored in `ADMIN_PASSWORD`. Missing credentials result in a
  `503` response.
- A successful login issues the `vpp-admin-auth` HTTP-only cookie (valid for 12
  hours) and the UI reuses the same session token for in-app API calls.
- Manual controls are available for Cloudflare smoke tests, sitemap purges,
  TiDB connectivity checks, Algolia index verification, and sitemap
  revalidation with status badges and structured activity logs.

### Build the project

```bash
yarn run prisma:deploy && yarn run setup && yarn run build
```

### Start the server

```bash
yarn start
```

### Open the browser

Open the browser and visit `http://<ip>:3000`.

## 📖 Development Reference

### Prisma

[Prisma Deployment Guide](https://www.prisma.io/docs/guides/deployment/deploying-to-vercel)

### Bookshop Schema

[Bookshop Schema Design](https://docs.pingcap.com/tidbcloud/dev-guide-bookshop-schema-design)
