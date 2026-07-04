/**
 * Injects a new random order into the running Foolix mock API every ~20s,
 * so the Operations Dashboard feels live (new orders keep arriving).
 *
 * Usage:  npm run inject          (with the server already running)
 * Env:    API_URL (default http://localhost:4000), INTERVAL_MS (default 20000)
 *
 * Requires Node 18+ (global fetch).
 */
const API_URL = process.env.API_URL || 'http://localhost:4000'
const INTERVAL_MS = Number(process.env.INTERVAL_MS) || 20000

const TYPES = ['dine_in', 'takeaway', 'delivery']
const NAMES = ['Ahmed', 'Mona', 'Youssef', 'Layla', 'Karim', 'Hana', 'Tarek', 'Salma']

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]
const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1))

async function login() {
  const res = await fetch(`${API_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'cashier@foolix.test', password: 'demo' }),
  })
  if (!res.ok) throw new Error(`login failed: ${res.status}`)
  const { token } = await res.json()
  return token
}

function buildOrder(products) {
  const available = products.filter((p) => p.available)
  const count = rand(1, 3)
  const items = []
  for (let i = 0; i < count; i++) {
    const p = pick(available)
    // maybe attach one random modifier
    const mods =
      p.modifiers && p.modifiers.length && Math.random() < 0.5 ? [pick(p.modifiers)] : []
    items.push({
      productId: p.id,
      name: p.name,
      qty: rand(1, 3),
      unitPrice: p.price,
      modifiers: mods.map((m) => ({ name: m.name, price: m.price })),
    })
  }
  const type = pick(TYPES)
  const order = { type, items, notes: '' }
  if (type === 'dine_in') order.table = rand(1, 12)
  if (type === 'delivery') order.customer = { name: pick(NAMES), phone: `010-${rand(1000000, 9999999)}` }
  return order
}

async function main() {
  const token = await login()
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }

  const res = await fetch(`${API_URL}/products`, { headers })
  const products = await res.json()
  if (!Array.isArray(products) || products.length === 0) {
    throw new Error('no products found — is the server seeded?')
  }

  console.log(`💉  Injecting a new order every ${INTERVAL_MS / 1000}s into ${API_URL} (Ctrl+C to stop)`)

  const inject = async () => {
    try {
      const order = buildOrder(products)
      const r = await fetch(`${API_URL}/orders`, {
        method: 'POST',
        headers,
        body: JSON.stringify(order),
      })
      const created = await r.json()
      console.log(`   + order #${created.number} (${created.type}) — ${created.total} EGP`)
    } catch (err) {
      console.error('   ! failed to inject order:', err.message)
    }
  }

  await inject()
  setInterval(inject, INTERVAL_MS)
}

main().catch((err) => {
  console.error('inject-orders stopped:', err.message)
  process.exit(1)
})
