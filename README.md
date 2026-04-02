# Agri-Pay

> A Lightning Network ↔ M-Pesa payment bridge for agricultural cooperatives in Kenya.

Agri-Pay lets cooperative administrators receive crop-payment funds over the **Bitcoin Lightning Network** (via BOLT12 offers) and automatically disburse them to farmers' mobile-money wallets via **Safaricom M-Pesa B2C**. A live BTC/KES exchange-rate oracle converts satoshis to Kenya Shillings at the moment each payment is created, giving farmers a transparent, auditable record of every transaction.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Running Tests](#running-tests)
- [Docker Deployment](#docker-deployment)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **BOLT12 Offer generation** — route-blinded, privacy-preserving Lightning invoices with QR codes
- **M-Pesa B2C disbursement** — one-click transfer from collected Lightning funds to a farmer's phone
- **Live FX oracle** — CoinGecko BTC/KES rate with configurable cache TTL; falls back to last-known rate
- **Payment state machine** — `pending → lightning_received → disbursing → completed | failed`
- **Farmer management** — register cooperative members with phone validation
- **Dashboard** — real-time stats, charts, and pending-disbursal queue
- **API-key authentication** — all `/api/*` routes protected by `X-Api-Key` header
- **Webhook security** — Safaricom callbacks authenticated via a secret token embedded in the callback URL
- **Versioned database migrations** — tracked in a `_migrations` table; safe to re-run on restart
- **Structured JSON logging** — toggleable between human-readable and production JSON via `LOG_FORMAT`

---

## Architecture

```
┌──────────────────────┐
│   React + Vite SPA   │  port 5173 (dev) │ static/index.html (prod)
└──────────┬───────────┘
           │  HTTP/JSON  X-Api-Key header
           ▼
┌──────────────────────────────────┐
│  Axum Web Server  (Rust)         │  port 3001
│  ├── /api/* (auth middleware)    │
│  └── /api/webhooks/mpesa/:secret │  (no auth, secret in path)
└──────┬───────────┬───────────────┘
       │           │           │
       ▼           ▼           ▼
  SQLite DB    LDK Node    M-Pesa Daraja
  (WAL mode)  (BOLT12)     (B2C API)
                              │
                      CoinGecko FX oracle
```

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| **Backend language** | Rust | 1.82 |
| **Async runtime** | Tokio | 1.x |
| **Web framework** | Axum | 0.7 |
| **Database** | SQLite (bundled) via tokio-rusqlite | 0.28 / 0.3 |
| **Lightning** | LDK Node | 0.4 |
| **HTTP client** | Reqwest (rustls) | 0.12 |
| **Serialization** | Serde / serde\_json | 1.x |
| **RSA encryption** | rsa crate | 0.9 |
| **Logging** | tracing / tracing-subscriber | 0.1 / 0.3 |
| **Frontend framework** | React | 18.3 |
| **Frontend language** | TypeScript | 5.5 |
| **Build tool** | Vite | 5.4 |
| **Styling** | Tailwind CSS | 3.4 |
| **State / data fetching** | TanStack React Query | 5.x |
| **Charts** | Recharts | 2.x |
| **Containerisation** | Docker + Docker Compose | — |

---

## Prerequisites

| Tool | Minimum version | Notes |
|---|---|---|
| Rust + Cargo | 1.82 | `rustup update stable` |
| Node.js | 20 | For the frontend |
| npm | 10 | Bundled with Node 20 |
| Docker + Compose | 24 / 2.x | Optional — for containerised deployment |
| M-Pesa Daraja account | — | Sandbox credentials available free at [developer.safaricom.co.ke](https://developer.safaricom.co.ke) |

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/comwanga/Agri-pay.git
cd Agri-pay
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in your credentials (see [Configuration](#configuration)).

### 3. Build and run the backend

```bash
cargo run
```

The server starts on `http://0.0.0.0:3001` by default.

### 4. Build and run the frontend

```bash
cd frontend
npm install
npm run dev
```

The dev server starts on `http://localhost:5173` and proxies `/api` to the backend.

---

## Configuration

All settings are read from environment variables (or a `.env` file in the project root).

| Variable | Default | Required | Description |
|---|---|---|---|
| `HOST` | `0.0.0.0` | No | Server bind address |
| `PORT` | `3001` | No | Server port |
| `DATABASE_URL` | `sqlite://agri-pay.db` | No | SQLite file path |
| `BITCOIN_NETWORK` | `regtest` | No | `mainnet` \| `testnet` \| `signet` \| `regtest` |
| `LDK_DATA_DIR` | `./ldk-data` | No | LDK node storage directory |
| `ESPLORA_URL` | blockstream testnet | No | Required for `testnet` / `mainnet` |
| `MPESA_ENV` | `sandbox` | No | `sandbox` \| `production` |
| `MPESA_CONSUMER_KEY` | — | **Yes (prod)** | Daraja API consumer key |
| `MPESA_CONSUMER_SECRET` | — | **Yes (prod)** | Daraja API consumer secret |
| `MPESA_SHORTCODE` | `600998` | No | M-Pesa business short code |
| `MPESA_INITIATOR_NAME` | `testapi` | No | B2C initiator name |
| `MPESA_INITIATOR_PASSWORD` | — | **Yes (prod)** | B2C initiator password |
| `MPESA_CERT_PATH` | — | **Yes (prod)** | Path to Safaricom RSA public key PEM. Extract with: `openssl x509 -pubkey -noout -in ProductionCertificate.cer > mpesa_prod_pubkey.pem` |
| `BASE_URL` | `http://localhost:3001` | No | Publicly reachable URL for M-Pesa callbacks |
| `WEBHOOK_SECRET` | `dev-webhook-secret` | **Yes (prod)** | Random secret embedded in callback URLs. Generate: `openssl rand -hex 32` |
| `API_KEY` | *(empty = disabled)* | **Yes (prod)** | Shared secret sent in `X-Api-Key` header by API clients |
| `ALLOWED_ORIGINS` | `http://localhost:5173` | No | Comma-separated CORS origins. Use `*` for dev |
| `COINGECKO_API_URL` | `https://api.coingecko.com/api/v3` | No | FX rate API base URL |
| `RATE_CACHE_SECONDS` | `60` | No | Seconds before a cached rate is considered stale |
| `LOG_FORMAT` | `text` | No | `text` (dev) or `json` (production) |
| `RUST_LOG` | `agri_pay=debug` | No | tracing log filter |

---

## Usage

### Creating a payment

1. **Add a farmer** — navigate to the Farmers page, click _Add Farmer_, and enter the farmer's name, Kenyan phone number (`07XX...` or `01XX...`), and cooperative name.

2. **Create a payment** — on the Payments page, click _New Payment_. Enter the KES amount, crop type, and select the farmer. The backend fetches a live BTC/KES rate, converts to satoshis, and generates a BOLT12 offer.

3. **Share the BOLT12 offer** — click the _BOLT12_ button on the payment row to view the QR code. The buyer scans it with any BOLT12-compatible Lightning wallet (e.g., Phoenix, Mutiny).

4. **Disburse to M-Pesa** — once the Lightning payment is received (status changes to _Lightning Received_), click _Disburse_. The backend sends an M-Pesa B2C transfer to the farmer's registered phone.

5. **Track status** — the dashboard shows real-time totals, pending disbursements, and a chart of recent payment activity.

### Authenticating API requests

Set the `X-Api-Key` header to the value of `API_KEY` in your `.env`:

```bash
curl -H "X-Api-Key: your-api-key" http://localhost:3001/api/dashboard/stats
```

When `API_KEY` is empty (default in `.env.example`), authentication is bypassed for local development.

---

## API Reference

All endpoints are prefixed with `/api`.

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{"status":"ok","version":"0.1.0"}` |

### Farmers

| Method | Path | Description |
|---|---|---|
| `GET` | `/farmers` | List all farmers |
| `POST` | `/farmers` | Create a farmer `{name, phone, cooperative}` |
| `GET` | `/farmers/:id` | Get a single farmer |

### Payments

| Method | Path | Description |
|---|---|---|
| `GET` | `/payments?page=1&per_page=50` | List payments (paginated, max 200/page) |
| `POST` | `/payments` | Create a payment `{farmer_id, amount_kes, crop_type?, notes?}` |
| `GET` | `/payments/:id` | Get a single payment |
| `POST` | `/payments/:id/disburse` | Initiate M-Pesa B2C transfer |

### Oracle

| Method | Path | Description |
|---|---|---|
| `GET` | `/oracle/rate` | Current BTC/KES and BTC/USD rate (live or cached) |

### Dashboard

| Method | Path | Description |
|---|---|---|
| `GET` | `/dashboard/stats` | Aggregate totals and pending count |

### Webhooks (no auth required)

| Method | Path | Description |
|---|---|---|
| `POST` | `/webhooks/mpesa/:secret/result` | M-Pesa B2C result callback |
| `POST` | `/webhooks/mpesa/:secret/timeout` | M-Pesa B2C timeout callback |

---

## Running Tests

```bash
# All tests (25 unit tests)
cargo test

# With output
cargo test -- --nocapture

# Specific module
cargo test mpesa
cargo test oracle
cargo test db
```

Frontend type-checking:

```bash
cd frontend
npx tsc --noEmit
```

---

## Docker Deployment

### Build and start

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env with production values

# Build the image and start services
docker compose up --build -d
```

The backend is available on port `3001`. The frontend dev server runs on `5173`; for production, build the frontend assets and serve them statically.

### Build frontend for production

```bash
cd frontend && npm install && npm run build
# Output lands in ../static/ and is served by the Axum server
```

### Volumes

| Volume | Purpose |
|---|---|
| `agri_data` | Persists `agri-pay.db` and `ldk/` node state across container restarts |

### Health check

Docker Compose polls `GET /api/health` every 30 seconds. The frontend service waits for `service_healthy` before starting.

---

## Payment Status Flow

```
┌─────────┐    Lightning     ┌───────────────────┐    M-Pesa B2C    ┌──────────┐
│ pending │ ──────────────▶  │ lightning_received │ ──────────────▶  │disbursing│
└─────────┘    payment       └───────────────────┘    initiated      └────┬─────┘
                                                                           │
                                                             ┌─────────────┴──────────┐
                                                             ▼                        ▼
                                                        ┌─────────┐            ┌────────┐
                                                        │completed│            │ failed │
                                                        └─────────┘            └────────┘
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes and run `cargo test` — all 25 tests must pass
4. Run `cargo fmt` and `cargo clippy -- -D warnings`
5. Submit a pull request against `main`

---

## License

This project is licensed under the [MIT License](LICENSE).
