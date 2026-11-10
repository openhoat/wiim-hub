import { Settings2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import type { Action } from '@/lib/api'
import { fetchSettings } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useSettings } from '@/lib/settings'
import type { DeviceSettings } from '@/lib/types'
import type { Controls } from '@/lib/use-controls'

// A setting the device stores itself. Every row reads its value from the
// speaker, writes once on an explicit gesture, then re-reads: the hub keeps no
// copy, so two clients cannot drift apart.
const Row = ({
  label,
  hint,
  children,
}: Readonly<{ label: string; hint?: string; children: React.ReactNode }>) => (
  <div className="flex items-center justify-between gap-3 py-2.5">
    <div className="min-w-0">
      <p className="text-xs font-medium">{label}</p>
      {hint !== undefined && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
)

const Toggle = ({
  on,
  disabled,
  onChange,
}: Readonly<{ on: boolean; disabled: boolean; onChange: (value: boolean) => void }>) => {
  const { t } = useSettings()
  return (
    <Button
      size="sm"
      variant={on ? 'default' : 'outline'}
      disabled={disabled}
      aria-pressed={on}
      onClick={() => onChange(!on)}
    >
      {on ? t('device.on') : t('device.off')}
    </Button>
  )
}

// A slider writes on release, never while dragging: the speaker is a small
// embedded server, and a drag would otherwise queue dozens of writes.
const Level = ({
  value,
  min,
  max,
  step,
  disabled,
  ariaLabel,
  format,
  onCommit,
}: Readonly<{
  value: number
  min: number
  max: number
  step: number
  disabled: boolean
  ariaLabel: string
  format?: (value: number) => string
  onCommit: (value: number) => void
}>) => {
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? value
  return (
    <div className={cn('flex items-center gap-2', format === undefined ? 'flex-1' : 'w-44')}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={shown}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={event => setDraft(Number(event.currentTarget.value))}
        onPointerUp={() => {
          if (draft === null) return
          onCommit(draft)
          setDraft(null)
        }}
        onKeyUp={() => {
          if (draft === null) return
          onCommit(draft)
          setDraft(null)
        }}
        onBlur={() => setDraft(null)}
        className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-muted accent-accent disabled:cursor-not-allowed disabled:opacity-50"
      />
      {format !== undefined && (
        <span className="w-10 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
          {format(shown)}
        </span>
      )}
    </div>
  )
}

// The rows themselves, without the sheet that carries them: the page shows them
// behind a card's settings button, and a member of a group shows them in its own
// sheet, since a member has no card of its own.
export const DeviceSettingsBody = ({ controls }: Readonly<{ controls: Controls }>) => {
  const { t } = useSettings()
  const device = controls.device
  const [settings, setSettings] = useState<DeviceSettings | null>(null)
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The device object is rebuilt by every poll, so the reader must not depend on
  // it: a `useCallback(…, [device])` changes identity every three seconds, the
  // effect below replays, and the sheet rewrites every row under the hand using
  // it. Typing a name took more than one poll, so the field could never reach
  // the save button. The ref carries the current device, read at call time.
  const deviceRef = useRef(device)
  useEffect(() => {
    deviceRef.current = device
  }, [device])

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const value = await fetchSettings(deviceRef.current)
      setSettings(value)
      setName(value.name)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  // One read when the sheet opens, and one after each write: the speaker holds
  // the values, so a read while the sheet is open would only undo what is being
  // typed there. The sheet mounts its content when it opens, so a mount is an
  // open.
  useEffect(() => {
    void load()
  }, [load])

  // A failed write leaves the speaker untouched: re-read anyway, so the row
  // shows what the device really holds instead of the value the user clicked.
  const save = async (action: Action): Promise<void> => {
    const ok = await controls.run(action)
    if (!ok) {
      setError(controls.error ?? t('device.writeFailed'))
      return
    }
    setError(null)
    await load()
  }

  const disabled = controls.pending
  const balance = settings?.balance ?? 0
  const ceiling = settings?.maxVolume ?? 100

  return (
    <>
      {loading && settings === null && (
        <p className="py-6 text-[11px] text-muted-foreground">{t('device.loading')}</p>
      )}

      {!loading && settings === null && (
        <div className="flex items-center gap-2 py-6">
          <p className="text-[11px] text-warning">{error ?? t('device.loadFailed')}</p>
          <Button size="sm" variant="outline" onClick={() => void load()}>
            {t('device.retry')}
          </Button>
        </div>
      )}

      {settings !== null && (
        <div className="mt-3 divide-y divide-border/60">
          <Row label={t('device.name')}>
            <div className="flex items-center gap-1.5">
              <input
                value={name}
                disabled={disabled}
                maxLength={32}
                aria-label={t('device.name')}
                onChange={event => setName(event.currentTarget.value)}
                className="h-8 w-40 rounded-lg border border-border bg-transparent px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              />
              <Button
                size="sm"
                disabled={disabled || name.trim() === '' || name.trim() === settings.name}
                onClick={() => void save({ action: 'rename', name })}
              >
                {t('device.save')}
              </Button>
            </div>
          </Row>

          {settings.ledOn !== null && (
            <Row label={t('device.led')} hint={t('device.ledHint')}>
              <Toggle
                on={settings.ledOn}
                disabled={disabled}
                onChange={on => void save({ action: 'led', on })}
              />
            </Row>
          )}

          {settings.buttonsOn !== null && (
            <Row label={t('device.buttons')} hint={t('device.buttonsHint')}>
              <Toggle
                on={settings.buttonsOn}
                disabled={disabled}
                onChange={on => void save({ action: 'buttons', on })}
              />
            </Row>
          )}

          {settings.fade !== null && (
            <Row label={t('device.fade')} hint={t('device.fadeHint')}>
              <Toggle
                on={settings.fade}
                disabled={disabled}
                onChange={on => void save({ action: 'fade', on })}
              />
            </Row>
          )}

          <Row label={t('device.balance')} hint={t('device.balanceHint')}>
            <div className="flex w-44 items-center gap-2">
              <span className="text-[11px] text-muted-foreground">L</span>
              <Level
                value={balance}
                min={-1}
                max={1}
                step={0.5}
                disabled={disabled}
                ariaLabel={`${t('device.balance')} ${balance}`}
                onCommit={value => void save({ action: 'balance', value })}
              />
              <span className="text-[11px] text-muted-foreground">R</span>
            </div>
          </Row>

          <Row label={t('device.maxVolume')} hint={t('device.maxVolumeHint')}>
            <Level
              value={ceiling}
              min={1}
              max={100}
              step={1}
              disabled={disabled}
              ariaLabel={t('device.maxVolume')}
              format={value => String(Math.round(value))}
              onCommit={value => void save({ action: 'maxVolume', level: Math.round(value) })}
            />
          </Row>
        </div>
      )}

      <p
        role="status"
        aria-live="polite"
        className={cn('mt-2 text-[11px] text-warning', error === null && 'sr-only')}
      >
        {error === null ? '' : t('device.failed', { error })}
      </p>
    </>
  )
}

export const DeviceSettingsDialog = ({ controls }: Readonly<{ controls: Controls }>) => {
  const { t } = useSettings()
  const device = controls.device
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('device.title')}
          disabled={!device.online}
        >
          <Settings2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('device.close')}>
        <DialogTitle className="text-sm font-medium">{t('device.title')}</DialogTitle>
        <DialogDescription className="mt-1 text-[11px] text-muted-foreground">
          {t('device.subtitle')}
        </DialogDescription>
        <DeviceSettingsBody controls={controls} />
      </DialogContent>
    </Dialog>
  )
}
