// Android builds the lock screen player of a page only when that page makes a
// sound: a tab that stays silent is a remote control, not a player, and no
// notification is ever created, however complete the media session is. The hub
// makes no sound of its own, because the music leaves by the speakers, so the
// page carries a track loud enough for the meter and silent to the ear: half a
// minute of a plain sine, looped, played at a volume nobody hears.
//
// "Silent" is measured, not declared. services/audio/output_stream.cc compares
// the output power with kSilenceThresholdDBFS, -72.24719896 dBFS, and a stream
// below that line never wakes the notification; media/base/audio_power_monitor
// averages the raw samples, so the frequency itself is not filtered out. Forty
// hertz is a frequency no phone speaker renders, which leaves the meter as the
// only listener. Measured on Chrome for Android, recorded in ADR 0004.
//
// The length is measured too: a two second track, at the very same level, still
// showed nothing on the lock screen, while a thirty second one showed the
// player on every attempt. Chrome drops a track it reads as a short sound, and
// the threshold sits somewhere between the two: thirty seconds keeps a wide
// margin instead of chasing the exact frontier.
const rate = 8000
const frequency = 40
const seconds = 30
// Sixteen bits of a sine: about -53 dBFS once the element volume below applies,
// nineteen decibels clear of the line Chrome draws. The same signal without the
// volume applied clears it by twenty-seven, so the track passes whichever side
// of the mixer the meter reads.
const amplitude = 260

// The element volume applied on top of the quiet track: the two multiply, so
// the phone stays silent even with its own volume up.
export const speakerVolume = 0.4

const ascii = (view: DataView, offset: number, text: string): void => {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index))
  }
}

// A thirty second mono WAV. 40 Hz at 8 kHz is exactly two hundred samples a
// cycle, so the track holds twelve hundred whole cycles and the loop seam falls
// on a zero crossing: no click every half minute, which would be audible even
// this quiet.
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
