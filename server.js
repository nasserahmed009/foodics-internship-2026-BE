/**
 * Foolix mock API — json-server wrapped with the "feels real" touches:
 *   - artificial latency          (loading states matter)
 *   - mock auth WITH ROLES        (login flow + role-based redirect + route guards)
 *   - server-computed order totals (trust the server, not the client)
 *   - payload validation -> 400   (error-state handling)
 *   - optional injected 500s      (retry UX)  [behind FAIL_RATE]
 *   - built-in filter/sort/paginate from json-server
 *
 * Run:   npm start           (http://localhost:4000)
 * Env:   PORT, TAX_RATE (default 0.14), LATENCY_MIN_MS, LATENCY_MAX_MS, FAIL_RATE (0..1)
 */
const path = require('path')
const jsonServer = require('json-server')

const server = jsonServer.create()
const router = jsonServer.router(path.join(__dirname, 'db.json'))
const middlewares = jsonServer.defaults()

const PORT = Number(process.env.PORT) || 4000
const TAX_RATE = Number(process.env.TAX_RATE ?? 0.14)
const LATENCY_MIN = Number(process.env.LATENCY_MIN_MS ?? 150)
const LATENCY_MAX = Number(process.env.LATENCY_MAX_MS ?? 550)
const FAIL_RATE = Number(process.env.FAIL_RATE ?? 0) // e.g. 0.1 -> ~10% of writes return 500

const round = (n) => Math.round(n * 100) / 100

// 0) Health check + docs site — registered BEFORE json-server's middleware so
//    they take precedence over json-server's built-in welcome page. No auth,
//    no latency. Only these specific files are exposed (never server.js /
//    db.json); they live at the repo root so GitHub Pages can also serve them
//    from `/`.
server.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() })
})
const DOCS_FILES = {
  '/': 'index.html',
  '/index.html': 'index.html',
  '/api-reference.html': 'api-reference.html',
  '/favicon.svg': 'favicon.svg',
}
Object.entries(DOCS_FILES).forEach(([route, file]) => {
  server.get(route, (req, res) => res.sendFile(path.join(__dirname, file)))
})

server.use(middlewares)
server.use(jsonServer.bodyParser)

// 1) Artificial latency on every request ------------------------------------
server.use((req, res, next) => {
  const delay = LATENCY_MIN + Math.random() * Math.max(0, LATENCY_MAX - LATENCY_MIN)
  setTimeout(next, delay)
})

// 2) Mock auth — /login issues a token + a user WITH A ROLE ------------------
// The FE stores the token, reads user.role, and redirects: cashier -> POS, admin -> dashboard.
server.post('/login', (req, res) => {
  const { email, password } = req.body || {}
  const user = router.db.get('users').find({ email: String(email || '').toLowerCase() }).value()
  if (!user || !password) {
    return res.status(401).json({ message: 'Invalid email or password' })
  }
  const { password: _pw, ...safeUser } = user // never echo a password field back
  return res.json({ token: `fake-jwt.${user.id}.${Date.now()}`, user: safeUser })
})

// 3) Auth guard — everything except /login needs a Bearer token --------------
server.use((req, res, next) => {
  if (req.path === '/login') return next()
  const auth = req.headers.authorization || ''
  if (!auth.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Unauthorized — missing or invalid token' })
  }
  next()
})

// 4) Optional failure injection on writes (exercise retry/error UX) ----------
server.use((req, res, next) => {
  const isWrite = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)
  if (FAIL_RATE > 0 && isWrite && Math.random() < FAIL_RATE) {
    return res.status(500).json({ message: 'Something went wrong. Please try again.' })
  }
  next()
})

// 5) Server-computed totals + validation on order creation -------------------
server.post('/orders', (req, res, next) => {
  const body = req.body || {}
  const items = Array.isArray(body.items) ? body.items : []

  if (items.length === 0) {
    return res.status(400).json({ message: 'An order must contain at least one item.' })
  }
  for (const it of items) {
    if (it.productId == null || !(Number(it.qty) > 0) || !(Number(it.unitPrice) >= 0)) {
      return res.status(400).json({ message: 'Each item needs a productId, a qty > 0 and a unitPrice.' })
    }
  }
  const validTypes = ['dine_in', 'takeaway', 'delivery']
  if (body.type && !validTypes.includes(body.type)) {
    return res.status(400).json({ message: `type must be one of: ${validTypes.join(', ')}` })
  }

  // Recompute every line total + the order totals server-side.
  const pricedItems = items.map((it) => {
    const modsTotal = Array.isArray(it.modifiers)
      ? it.modifiers.reduce((s, m) => s + (Number(m.price) || 0), 0)
      : 0
    const lineTotal = round((Number(it.unitPrice) + modsTotal) * Number(it.qty))
    return { ...it, lineTotal }
  })
  const subtotal = round(pricedItems.reduce((s, it) => s + it.lineTotal, 0))
  const tax = round(subtotal * TAX_RATE)
  const total = round(subtotal + tax)

  // Next human-facing order number (4-digit, starts at 1000).
  const orders = router.db.get('orders').value() || []
  const number = orders.reduce((max, o) => Math.max(max, o.number || 0), 999) + 1

  req.body = {
    number,
    status: 'pending',
    type: body.type || 'takeaway',
    items: pricedItems,
    subtotal,
    tax,
    total,
    notes: body.notes || '',
    table: body.table ?? null,
    customer: body.customer ?? null,
    createdAt: new Date().toISOString(),
  }
  next() // hand the enriched body to json-server to persist + assign an id
})

// 6) Everything else is standard json-server ---------------------------------
//    /products?categoryId=&available=&q=&_page=&_limit=&_sort=&_order=
//    PATCH /orders/:id  (status transitions)   PATCH /products/:id (availability/edit)
server.use(router)

server.listen(PORT, () => {
  console.log(`\n🫘  Foolix mock API listening on port ${PORT} (local: http://localhost:${PORT})`)
  console.log(`    tax ${+(TAX_RATE * 100).toFixed(2)}% · latency ${LATENCY_MIN}-${LATENCY_MAX}ms · fail rate ${FAIL_RATE}`)
  console.log(`    logins: cashier@foolix.test (cashier) · admin@foolix.test (admin) — any non-empty password\n`)
})
