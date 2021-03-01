export interface Instrument {
  start: number | null
}

export const makeInstrument = (): Instrument => ({
  start: null
})

export const startInstrument = (
  instrument: Instrument,
  start: number
): void => {
  if (instrument.start == null) {
    instrument.start = start
  }
}

export const measureInstrument = (
  instrument: Instrument,
  end: number
): number => (instrument.start != null ? end - instrument.start : 0)

export const endInstrument = (instrument: Instrument, end: number): number => {
  const measurement = measureInstrument(instrument, end)
  instrument.start = null
  return measurement
}
