import { addToAverage } from './utils'

export interface Metric {
  total: number
  value: number
  sum: number
  avg: number
  min: number
  max: number
}

export const makeMetric = (): Metric => ({
  total: 0,
  value: 0,
  sum: 0,
  avg: 0,
  min: 0,
  max: 0
})

export const addToMetric = (metric: Metric, value: number): void => {
  metric.value = value
  metric.sum += value
  metric.avg = addToAverage(value, metric.avg, metric.total++)
  metric.min = Math.min(value, metric.min)
  metric.max = Math.max(value, metric.max)
}
