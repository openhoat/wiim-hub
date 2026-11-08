import { ChevronDown, Copy, Download, SignalHigh, SignalLow, SignalZero } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { EventTimeline } from '@/components/event-timeline'
import { SampleTable } from '@/components/sample-table'
import { Sparkline } from '@/components/sparkline'
import { cn } from '@/lib/cn'
import { csvOf, download, fileStamp } from '@/lib/format'
import { agoLabel, statusLabel } from '@/lib/labels'
import { useSettings } from '@/lib/settings'
import type { Device } from '@/lib/types'

const Field = ({ label, value }: Readonly<{ label: string; value: string }>) => (
  <div className="min-w-0">
    <dt className="text-[11px] text-muted-foreground">{label}</dt>
    <dd className="truncate text-xs" title={value}>
      {value}
    </dd>
  </div>
)

export const DiagnosticCard = ({ device, now }: Readonly<{ device: Device; now: number }>) => {
  const { t } = useSettings()
  const [details, setDetails] = useState(false)
  const live = useMemo(() => device.samples.slice(-120), [device.samples])
  const rssi = device.rssi
  const SignalIcon = rssi === null ? SignalZero : rssi <= -70 ? SignalLow : SignalHigh

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(device.ip)
      toast.success(t('copied'))
    } catch {
      toast.error(t('copy'))
    }
  }

  const exportAs = (format: 'csv' | 'json'): void => {
    const name = `wiim-hub-${device.name || device.ip}-${fileStamp()}`
    if (format === 'csv') {
      download(`${name}.csv`, csvOf(device.samples), 'text/csv;charset=utf-8')
      return
    }
    download(`${name}.json`, JSON.stringify(device, null, 2), 'application/json;charset=utf-8')
  }

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-sm font-medium">{device.name}</h2>
            <Badge variant={device.online ? 'accent' : 'warning'}>
              <span className={cn('size-1.5 rounded-full', device.online ? 'bg-accent' : 'bg-warning')} />
              {device.online ? t('online') : t('offline')}
            </Badge>
          </div>
          <p className="truncate text-[11px] text-muted-foreground">{device.model || device.ip}</p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <Download className="size-3.5" />
              {t('export')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => exportAs('csv')}>{t('exportCsv')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => exportAs('json')}>{t('exportJson')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <section>
          <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t('sections.fields')}</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            <div className="col-span-2">
              <dt className="text-[11px] text-muted-foreground">{t('labels.address')}</dt>
              <dd className="flex items-center gap-1">
                <span className="truncate font-mono text-xs" title={device.ip}>
                  {device.ip}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="size-6 shrink-0 text-muted-foreground"
                  aria-label={t('copy')}
                  onClick={() => void copy()}
                >
                  <Copy className="size-3" />
                </Button>
              </dd>
            </div>
            <Field label={t('labels.firmware')} value={device.firmware || '—'} />
            <Field label={t('labels.state')} value={statusLabel(t, device.status)} />
            <Field label={t('labels.network')} value={device.ssid || '—'} />
            <Field label={t('labels.bssid')} value={device.bssid || '—'} />
            <Field label={t('labels.group')} value={device.group || '—'} />
            <Field label={t('labels.source')} value={device.source || '—'} />
            <Field label={t('labels.volume')} value={device.volume === null ? '—' : String(device.volume)} />
            <Field label={t('labels.lastSeen')} value={agoLabel(t, device.lastSeen, now)} />
            <Field label={t('labels.failures')} value={String(device.errors)} />
          </dl>
        </section>

        <section className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t('sections.signal')}</h3>
            <span className="inline-flex items-center gap-1 text-xs tabular-nums">
              <SignalIcon className={cn('size-3.5', rssi !== null && rssi <= -70 ? 'text-warning' : 'text-muted-foreground')} />
              {rssi === null ? t('rssiUnknown') : t('rssi', { value: rssi })}
            </span>
          </div>
          <div className="mt-1 rounded-lg border border-border/60 bg-muted/20 px-2 pt-2">
            {live.length > 0 ? <Sparkline samples={live} /> : <div className="grid h-16 place-items-center text-xs text-muted-foreground">{t('noSamples')}</div>}
          </div>
          <p className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{t('rssiChart')}</span>
            {rssi !== null && rssi <= -70 && (
              <Badge variant="warning" className="text-[10px]">
                {t('weakSignal')}
              </Badge>
            )}
          </p>
        </section>
      </div>

      <section className="mt-5">
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{t('sections.timeline')}</h3>
        <EventTimeline events={device.events} />
      </section>

      <div className="mt-4 border-t border-border/60 pt-3">
        <Button variant="ghost" size="sm" onClick={() => setDetails((value) => !value)} aria-expanded={details}>
          <ChevronDown className={cn('size-3.5 transition-transform', details && 'rotate-180')} />
          {details ? t('hideDetails') : t('details')}
        </Button>
        {details && (
          <div className="mt-3">
            <SampleTable samples={device.samples} />
          </div>
        )}
      </div>
    </Card>
  )
}
