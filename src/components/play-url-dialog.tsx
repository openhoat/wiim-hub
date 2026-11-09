import { Link2, Play } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { controlErrorLabel } from '@/lib/labels'
import { useSettings } from '@/lib/settings'
import type { Controls } from '@/lib/use-controls'

// A stream address is the one playback the hub can start without an account:
// the speaker fetches it itself. The dialog is the confirmation, so the click
// on Play always names what the device is about to load.
const looksLikeStream = (value: string): boolean => /^https?:\/\/\S+$/i.test(value.trim())

export const PlayUrlDialog = ({ controls }: Readonly<{ controls: Controls }>) => {
  const { t } = useSettings()
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')
  const disabled = !controls.device.online || controls.pending
  const valid = looksLikeStream(url)

  const play = async (): Promise<void> => {
    const ok = await controls.run({ action: 'url', url: url.trim() })
    if (!ok) return
    setOpen(false)
    setUrl('')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={!controls.device.online} className="gap-1.5">
          <Link2 className="size-3.5" />
          {t('stream.open')}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('stream.close')}>
        <DialogTitle className="text-sm font-medium">{t('stream.title')}</DialogTitle>
        <DialogDescription className="mt-1 text-[11px] text-muted-foreground">
          {t('stream.hint')}
        </DialogDescription>

        <form
          className="mt-4 flex flex-col gap-2 sm:flex-row"
          onSubmit={event => {
            event.preventDefault()
            if (valid && !disabled) void play()
          }}
        >
          {/* Radix moves the focus to the first focusable element when the dialog
              opens, which is this field: an autoFocus attribute would repeat it. */}
          <input
            value={url}
            inputMode="url"
            spellCheck={false}
            placeholder="https://…"
            aria-label={t('stream.address')}
            onChange={event => setUrl(event.currentTarget.value)}
            className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-transparent px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          />
          <Button type="submit" disabled={disabled || !valid} className="gap-1.5">
            <Play className="size-3.5" />
            {t('stream.play')}
          </Button>
        </form>

        <p
          role="status"
          aria-live="polite"
          className={controls.error === null ? 'sr-only' : 'mt-2 text-[11px] text-warning'}
        >
          {controlErrorLabel(t, controls.error)}
        </p>
      </DialogContent>
    </Dialog>
  )
}
