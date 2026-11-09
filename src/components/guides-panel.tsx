import { Check, CircleHelp, TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'
import { type Translate, useSettings } from '@/lib/settings'
import type { CheckStatus, Device, Guide, GuideId } from '@/lib/types'

const icons: Record<CheckStatus, typeof Check> = {
  pass: Check,
  warn: TriangleAlert,
  fail: X,
  unknown: CircleHelp,
}

const tones: Record<CheckStatus, string> = {
  pass: 'text-muted-foreground/60',
  warn: 'text-warning',
  fail: 'text-danger',
  unknown: 'text-muted-foreground',
}

// A flow that found something is worth opening: the tab carries the dot, so the
// user does not have to click through four tabs to find the one that matters.
const attention = (guide: Guide): CheckStatus | null =>
  guide.verdict === null ? null : guide.verdict.status

const CheckRow = ({ check }: Readonly<{ check: Guide['checks'][number] }>) => {
  const { t } = useSettings()
  const Icon = icons[check.status]
  const notable = check.status !== 'pass'
  return (
    <li className="flex items-start gap-2">
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', tones[check.status])} aria-hidden="true" />
      <div className="min-w-0">
        <p className={cn('text-xs break-words', notable && 'font-medium')}>
          <span className="sr-only">{t(`guides.status.${check.status}`)}: </span>
          {t(`guides.check.${check.id}`, check.values)}
        </p>
        {notable && (
          <p className="mt-0.5 font-mono text-[11px] break-words text-muted-foreground">
            {check.evidence}
          </p>
        )}
      </div>
    </li>
  )
}

// The closing line says what the flow's end means: nothing to report, a verdict
// the flow stopped on, or a verdict the player could not answer.
const noteOf = (guide: Guide, t: Translate): string => {
  if (guide.verdict === null) return t('guides.note')
  return guide.settled ? t('guides.stopped') : t('guides.unsettled')
}

// The four flows are deterministic readings, not advice: each row names the
// field it read, and the last row of a flow that found something is the first
// anomaly, which is where the reading stopped.
export const GuidesPanel = ({ device }: Readonly<{ device: Device }>) => {
  const { t } = useSettings()
  const [picked, setPicked] = useState<GuideId>('no-sound')
  const guide = device.guides.find(entry => entry.id === picked) ?? device.guides[0]
  if (guide === undefined) return null
  return (
    <section data-testid="guides-panel">
      <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {t('guides.title')}
      </h3>
      <div role="tablist" aria-label={t('guides.title')} className="mt-2 flex flex-wrap gap-1">
        {device.guides.map(entry => {
          const status = attention(entry)
          return (
            <Button
              key={entry.id}
              role="tab"
              size="sm"
              variant={entry.id === guide.id ? 'secondary' : 'ghost'}
              aria-selected={entry.id === guide.id}
              onClick={() => setPicked(entry.id)}
            >
              {status !== null && (
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    status === 'fail' ? 'bg-danger' : 'bg-warning'
                  )}
                />
              )}
              {t(`guides.label.${entry.id}`)}
            </Button>
          )
        })}
      </div>
      <ol className="mt-2.5 space-y-1.5">
        {guide.checks.map(check => (
          <CheckRow key={check.id} check={check} />
        ))}
      </ol>
      {guide.verdict === null && (
        <p className="mt-2">
          <Badge variant="accent" className="text-[10px]">
            {t('guides.none')}
          </Badge>
        </p>
      )}
      <p className="mt-1.5 text-[11px] text-muted-foreground">{noteOf(guide, t)}</p>
    </section>
  )
}
