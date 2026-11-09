import { ChevronDown } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fetchServices } from '@/lib/api'
import { cn } from '@/lib/cn'
import { isActive, orderServices, tierOf } from '@/lib/services'
import { useSettings } from '@/lib/settings'
import type { Device, ServiceCapability } from '@/lib/types'

// A reference table, read once when the card opens: it changes with a firmware
// update, not with a track, so it has no business in the poll.
//
// What it answers is narrow on purpose. "Which tier can this model reach on
// Tidal" is a fact the firmware publishes; "will my subscription give me that"
// is not, and neither is "what bitrate is HI_RES". The rows show the top of the
// ladder the device listed, the ladder itself on hover, and a dash where the
// vendor app owns the answer.
export const ServicesPanel = ({ device }: Readonly<{ device: Device }>) => {
  const { t } = useSettings()
  const [services, setServices] = useState<ServiceCapability[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [all, setAll] = useState(false)

  useEffect(() => {
    let live = true
    setServices(null)
    setError(null)
    // A silent player publishes nothing, and the probe would only cost a
    // timeout to learn the first finding again.
    if (!device.online) return
    fetchServices(device.ip)
      .then(answer => {
        if (live) setServices(answer.services)
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      live = false
    }
  }, [device.ip, device.online])

  const ordered = orderServices(services ?? [], device.source)
  // Publishing families first, and the one in use whatever it publishes: a
  // service that says nothing is worth one line when it is the one playing.
  const named = ordered.filter(
    service => service.levels.length > 0 || isActive(service, device.source)
  )
  const shown = all ? ordered : named

  return (
    <section data-testid="services-panel">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {t('sections.services')}
        </h3>
        {services !== null && services.length > 0 && (
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {t('services.count', { count: services.length })}
          </span>
        )}
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">{t('services.hint')}</p>

      {!device.online && (
        <p className="mt-2 text-xs text-muted-foreground">{t('services.offline')}</p>
      )}

      {error !== null && (
        <p className="mt-2 text-xs text-warning">
          {t('services.failed')} {error}
        </p>
      )}

      {device.online && error === null && services === null && (
        <p className="mt-2 text-xs text-muted-foreground">{t('services.loading')}</p>
      )}

      {device.online && services !== null && services.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">{t('services.none')}</p>
      )}

      {shown.length > 0 && (
        <dl className="mt-2 grid gap-x-6 sm:grid-cols-2">
          {shown.map(service => {
            const tier = tierOf(service)
            const active = isActive(service, device.source)
            const detail = [tier?.ladder, service.replayGain ? t('services.replayGain') : null]
              .filter(part => part !== undefined && part !== null)
              .join(' · ')
            return (
              <div
                key={service.id}
                className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1 last:border-0"
                title={detail === '' ? undefined : detail}
              >
                <dt className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-xs">{service.id}</span>
                  {active && (
                    <Badge variant="accent" className="shrink-0 text-[10px]">
                      {t('services.inUse')}
                    </Badge>
                  )}
                </dt>
                <dd className="shrink-0 font-mono text-xs text-muted-foreground">
                  {tier === null ? '—' : tier.top}
                </dd>
              </div>
            )
          })}
        </dl>
      )}

      {ordered.length > named.length && (
        <Button
          variant="ghost"
          size="sm"
          className="mt-1 -ml-2 text-[11px]"
          aria-expanded={all}
          onClick={() => setAll(value => !value)}
        >
          <ChevronDown className={cn('size-3 transition-transform', all && 'rotate-180')} />
          {all
            ? t('services.showFewer')
            : t('services.showAll', { count: ordered.length - named.length })}
        </Button>
      )}
    </section>
  )
}
