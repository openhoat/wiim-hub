import { useEffect, useRef, useState } from 'react'
import { quietTrack, speakerVolume } from '@/lib/speaker'

// Android builds no lock screen player for a page that makes no sound: the tab
// is a remote control, not a player (measured on Chrome for Android, ADR 0004).
// The hub makes no sound, because the music leaves by the speakers, so this
// element is the smallest one that keeps the page a player: half a minute of a
// sine at a level nobody hears, looped, played while the published card plays.
// The length is part of the recipe: a two second loop still showed no player on
// Android, a thirty second one does (ADR 0004).
// It is never seen, never controlled, and never cached: it lives as a blob.
export const InvisibleSpeaker = ({ playing }: Readonly<{ playing: boolean }>) => {
  const [src] = useState(() => URL.createObjectURL(new Blob([quietTrack()], { type: 'audio/wav' })))
  const element = useRef<HTMLAudioElement | null>(null)
  const wanted = useRef(playing)

  useEffect(() => {
    wanted.current = playing
  }, [playing])

  useEffect(() => () => URL.revokeObjectURL(src), [src])

  useEffect(() => {
    const audio = element.current
    if (audio === null) return
    audio.volume = speakerVolume
    if (!playing) {
      audio.pause()
      return
    }
    // A browser that has not seen a gesture yet refuses to start a sound. The
    // page arms the first gesture rather than asking the reader for one: the
    // music is already playing, nothing on screen should have to be pressed.
    void audio.play().catch(() => {
      const start = (): void => {
        if (wanted.current) void audio.play().catch(() => undefined)
      }
      window.addEventListener('pointerdown', start, { once: true, passive: true })
    })
  }, [playing])

  return (
    // biome-ignore lint/a11y/useMediaCaption: an inaudible tone has nothing to caption
    <audio ref={element} src={src} loop preload="auto" data-testid="invisible-speaker" />
  )
}
