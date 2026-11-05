import { useEffect, useState } from 'react'
import type { Overview } from '../../shared/types'

export function useOverview() {
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    const es = new EventSource('/api/events')
    es.onmessage = (e) => { setData(JSON.parse(e.data)); setError(false) }
    es.onerror = () => setError(true)
    return () => es.close()
  }, [])
  return { data, error }
}
