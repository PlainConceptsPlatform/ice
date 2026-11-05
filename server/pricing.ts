// Estimated prices in USD per million tokens. Edit here; this is an ESTIMATE, not the invoice.
interface Price { input: number; output: number; cacheRead: number; cacheWrite5m: number; cacheWrite1h: number }

const PRICES: { match: RegExp; price: Price }[] = [
  { match: /opus/, price: { input: 5, output: 25, cacheRead: 0.5, cacheWrite5m: 6.25, cacheWrite1h: 10 } },
  { match: /sonnet/, price: { input: 3, output: 15, cacheRead: 0.3, cacheWrite5m: 3.75, cacheWrite1h: 6 } },
  { match: /haiku/, price: { input: 1, output: 5, cacheRead: 0.1, cacheWrite5m: 1.25, cacheWrite1h: 2 } },
]

export interface Usage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
}

export function costOf(model: string, u: Usage): number {
  const p = PRICES.find((x) => x.match.test(model))?.price
  if (!p) return 0
  const w5 = u.cache_creation?.ephemeral_5m_input_tokens
  const w1 = u.cache_creation?.ephemeral_1h_input_tokens
  const total = u.cache_creation_input_tokens ?? 0
  const write5 = w5 ?? (w1 === undefined ? total : 0)
  const write1 = w1 ?? 0
  return (
    ((u.input_tokens ?? 0) * p.input +
      (u.output_tokens ?? 0) * p.output +
      (u.cache_read_input_tokens ?? 0) * p.cacheRead +
      write5 * p.cacheWrite5m +
      write1 * p.cacheWrite1h) /
    1e6
  )
}
