# Foolix Mock API

The provided mock backend for the **Foolix** FE internship project — a foul & ta3meya ordering
platform. It's a [`json-server`](https://github.com/typicode/json-server) wrapped in a small
`server.js` that adds the touches that make it feel like a real backend: latency, role-based mock
auth, server-computed order totals, validation, and (optionally) injected failures.

Interns **consume** this API — they don't edit it.

## Quick start

```bash
npm install
npm start          # http://localhost:4000
```

Point the frontend at it with `VITE_API_BASE_URL=http://localhost:4000`.

### Seed logins

`POST /login` returns `{ token, user }` where `user.role` drives the redirect. Any **non-empty
password** works.

| Email | Role | Lands on |
|---|---|---|
| `cashier@foolix.test` | `cashier` | Cashier / POS area |
| `admin@foolix.test` | `admin` | Operations Dashboard |

Every request except `POST /login` needs an `Authorization: Bearer <token>` header (a `401` is
returned otherwise).

## Endpoints

```
POST   /login                 -> { token, user: { id, name, email, role } }
GET    /categories
GET    /products              ?categoryId=&available=&q=&_page=&_limit=&_sort=&_order=
GET    /products/:id
POST   /orders                (server computes number, totals, tax, status, createdAt)
GET    /orders                ?status=&type=&_page=&_limit=&_sort=createdAt&_order=desc
GET    /orders/:id
PATCH  /orders/:id            (e.g. { "status": "preparing" })
PATCH  /products/:id          (toggle availability / edit)
```

`json-server` gives filtering (`?field=value`), full-text search (`?q=`), pagination
(`?_page=&_limit=`, with an `X-Total-Count` header) and sorting (`?_sort=&_order=`) for free.

### What the server computes on `POST /orders`

You send `{ type, items: [{ productId, name, qty, unitPrice, modifiers: [{ name, price }] }], notes, table?, customer? }`.
The server ignores any client-sent totals and returns the authoritative order:

- `lineTotal` per item = `(unitPrice + Σ modifier.price) × qty`
- `subtotal` = Σ line totals · `tax` = `subtotal × 14%` · `total` = `subtotal + tax`
- a fresh 4-digit `number`, `status: "pending"`, and `createdAt`

Bad payloads (no items, `qty <= 0`, invalid `type`) return `400`.

## Make the dashboard feel live

In a second terminal, with the server running:

```bash
npm run inject     # posts a new random order every ~20s
```

## Configuration (env vars)

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | Port to listen on |
| `TAX_RATE` | `0.14` | VAT applied to order subtotals |
| `LATENCY_MIN_MS` / `LATENCY_MAX_MS` | `150` / `550` | Artificial latency range |
| `FAIL_RATE` | `0` | Probability (0–1) that a write returns `500` — set e.g. `0.1` to exercise retry UX |
| `API_URL` / `INTERVAL_MS` | `http://localhost:4000` / `20000` | Used by `npm run inject` |

Example: `FAIL_RATE=0.1 npm start`

## Resetting the data

`json-server` writes new orders into `db.json`. To restore the original seed, revert the file
(`git checkout db.json`).

## Deploying (optional) — Render

For an isolated instance per team, deploy this repo as a **Render Web Service** (one per team):

1. Push this folder to a GitHub repo.
2. Render → **New → Web Service** → connect the repo.
3. Build command `npm install`, start command `npm start`, Free instance.
4. Use the resulting URL (e.g. `https://foolix-mock-team-a.onrender.com`) as the team's API base.

Notes: the free tier sleeps after ~15 min idle (first request is slow), and the filesystem is
ephemeral — `db.json` resets on redeploy/restart. For a mock, that's usually fine. See
`../MOCK_BACKEND.md` for the full hosting rationale and alternatives.
