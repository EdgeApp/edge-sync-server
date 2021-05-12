import pinoPretty from 'pino-pretty'
import { createInterface } from 'readline'

import { print, statusBarLine, statusBox } from './utils/printing'

const pretty = pinoPretty({})

const rl = createInterface({
  input: process.stdin
})

rl.on('line', line => {
  const log = JSON.parse(line)

  if (log.msg === 'status') {
    statusBox(log.status.join('\n' + statusBarLine() + '\n'))
  } else {
    print(pretty(log))
  }
})
