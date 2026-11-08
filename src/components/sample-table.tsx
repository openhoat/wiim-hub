import { useSettings } from '@/lib/settings'
import { statusLabel } from '@/lib/labels'
import type { Sample } from '@/lib/types'

const clockOf = (at: number): string =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(at)

// The table reads newest first: a diagnostic session starts with "what just
// happened", not with the oldest retained sample.
export const SampleTable = ({ samples }: Readonly<{ samples: Sample[] }>) => {
  const { t } = useSettings()
  const rows = samples.slice(-24).reverse()
  if (rows.length === 0) {
    return <p className="py-3 text-xs text-muted-foreground">{t('noSamples')}</p>
  }
  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-border/70">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-muted/80 backdrop-blur">
          <tr className="text-[11px] text-muted-foreground">
            <th className="px-3 py-1.5 font-medium">{t('table.time')}</th>
            <th className="px-3 py-1.5 text-right font-medium">{t('table.rssi')}</th>
            <th className="px-3 py-1.5 text-right font-medium">{t('table.volume')}</th>
            <th className="px-3 py-1.5 font-medium">{t('table.state')}</th>
            <th className="px-3 py-1.5 font-medium">{t('table.online')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/60 tabular-nums">
          {rows.map((sample) => (
            <tr key={sample.t} className={sample.online ? undefined : 'text-muted-foreground/70'}>
              <td className="px-3 py-1">{clockOf(sample.t)}</td>
              <td className="px-3 py-1 text-right">{sample.rssi ?? '—'}</td>
              <td className="px-3 py-1 text-right">{sample.volume ?? '—'}</td>
              <td className="px-3 py-1">{statusLabel(t, sample.status)}</td>
              <td className="px-3 py-1">{sample.online ? t('online') : t('offline')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
