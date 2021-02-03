import { max } from 'biggystring'

// Extends biggystring's max function
export const maxAll = (...n: string[]): string => n.reduce((a, n) => max(a, n))
