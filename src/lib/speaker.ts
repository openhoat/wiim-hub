// Android builds the lock screen player of a page only when that page makes a
// sound: a tab that stays silent is a remote control, not a player, and no
// notification is ever created, however complete the media session is. The hub
// makes no sound of its own, because the music leaves by the speakers, so the
// page carries the quietest track that keeps it a player: two seconds of a
// plain sine, looped, played at a volume nobody hears. Measured on Chrome for
// Android, recorded in ADR 0004.
const rate = 8000
const frequency = 200
const seconds = 2
// Sixteen bits of a sine, about -72 dBFS: below what a phone speaker renders,
// and nowhere near digital silence, which Chrome discards.
const amplitude = 8

// The element volume applied on top of the quiet track: the two multiply, so
// the phone stays silent even with its own volume up.
export const speakerVolume = 0.4

const ascii = (view: DataView, offset: number, text: string): void => {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index))
  }
}

// A 2 second mono WAV. 200 Hz at 8 kHz is exactly forty samples a cycle, so two
// seconds hold four hundred whole cycles and the loop seam falls on a zero
// crossing: no click once a second, which would be audible even this quiet.
export const quietTrack = (): Uint8Array<ArrayBuffer> => {
  const frames = rate * seconds
  const bytes = new Uint8Array(44 + frames * 2)
  const view = new DataView(bytes.buffer)
  ascii(view, 0, 'RIFF')
  view.setUint32(4, 36 + frames * 2, true)
  ascii(view, 8, 'WAVE')
  ascii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, rate, true)
  view.setUint32(28, rate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(view, 36, 'data')
  view.setUint32(40, frames * 2, true)
  for (let frame = 0; frame < frames; frame += 1) {
    const sample = Math.round(amplitude * Math.sin((2 * Math.PI * frame * frequency) / rate))
    view.setInt16(44 + frame * 2, sample, true)
  }
  return bytes
}

// The track is published while the card the lock screen shows plays, and held
// paused otherwise: a paused player keeps its notification, a page that never
// played a sound has none.
export const speakerPlays = (status: string): boolean => status === 'play'
