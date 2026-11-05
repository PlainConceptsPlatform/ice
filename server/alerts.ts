import type { Alert, SessionState } from '../shared/types.ts'

const COST_ALERT = Number(process.env.ICE_COST_ALERT ?? 50)

export function alertsFor(s: { cost: number; costKnown: boolean; compactions: number; state: SessionState; errors?: number }): Alert[] {
  const alerts: Alert[] = []
  if (s.costKnown && s.cost >= COST_ALERT)
    alerts.push({ kind: 'cost', message: `Estimated cost $${s.cost.toFixed(0)} (threshold $${COST_ALERT})` })
  if (s.compactions >= 2)
    alerts.push({ kind: 'compactions', message: `${s.compactions} compactions: consider splitting the task` })
  if (s.state === 'needs-you') alerts.push({ kind: 'waiting', message: 'Waiting for your decision' })
  return alerts
}
