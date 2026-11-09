import { ChevronRight, Copy, Download, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { fetchReport, type Report } from '@/lib/api'
import { download, fileStamp } from '@/lib/format'
import { agoLabel } from '@/lib/labels'
import { useSettings } from '@/lib/settings'
import type { Device, Finding } from '@/lib/types'

// Severity only drives the colour: every finding carries its own numbers, so a
// red badge does not have to explain more than how urgent the fact is.
const variantOf = (severity: Finding['severity']): 'danger' | 'warning' | 'default' =>
  severity === 'alert' ? 'danger' : severity === 'warn' ? 'warning' : 'default'

// Most urgent first: the reader should not have to scan the list to find the
// one line that matters.
const rank = { alert: 0, warn: 1, info: 2 }

const ordered = (findings: Finding[]): Finding[] =>
  [...findings].sort((left, right) => rank[left.severity] - rank[right.severity])

const FindingRow = ({ finding }: Readonly<{ finding: Finding }>) => {
  const { t } = useSettings()
  return (
    <details className="group rounded-lg border border-border/60 bg-muted/20 px-3 py-2">
      <summary className="flex cursor-pointer list-none items-start gap-2 text-xs [&::-webkit-details-marker]:hidden">
        <Badge variant={variantOf(finding.severity)} className="mt-px shrink-0">
          {t(`findings.severity.${finding.severity}`)}
        </Badge>
        <span className="min-w-0 flex-1">{t(`findings.${finding.id}`, finding.values)}</span>
        <ChevronRight className="mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <ul className="mt-2 space-y-0.5 border-t border-border/60 pt-2 font-mono text-[11px] break-words text-muted-foreground">
        {finding.evidence.map(line => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </details>
  )
}

// What the clean state is made of: the same signals the rules read, so "no
// anomaly" is a measurement and not a shrug.
export const cleanChecks = (device: Device, t: ReturnType<typeof useSettings>['t']): string[] => {
  const checks: string[] = []
  if (device.rssi !== null) checks.push(t('findings.checked.rssi', { value: device.rssi }))
  if (device.link.snr !== null) checks.push(t('findings.checked.snr', { value: device.link.snr }))
  const health = device.diagnostics?.health ?? null
  if (health !== null && health.disconnected !== null) {
    checks.push(t('findings.checked.drops', { value: health.disconnected }))
  }
  const debug = device.diagnostics?.debug ?? null
  if (debug !== null) {
    const crashes = Object.values(debug.crashes).reduce<number>(
      (acc, value) => acc + (value ?? 0),
      0
    )
    checks.push(t('findings.checked.crashes', { value: crashes }))
    if (debug.upnpActionsLost !== null) {
      checks.push(t('findings.checked.upnp', { value: debug.upnpActionsLost }))
    }
  }
  const hardware = device.diagnostics?.hardware ?? null
  if (hardware !== null && hardware.badBlocks !== null && hardware.totalBlocks !== null) {
    checks.push(
      t('findings.checked.flash', { bad: hardware.badBlocks, total: hardware.totalBlocks })
    )
  }
  return checks
}

export const FindingsPanel = ({ device, now }: Readonly<{ device: Device; now: number }>) => {
  const { t } = useSettings()
  const [busy, setBusy] = useState(false)
  const findings = ordered(device.findings)
  const checks = cleanChecks(device, t)
  const diagnostics = device.diagnostics

  const withReport = async (
    use: (report: Report) => void | Promise<void>,
    message: string
  ): Promise<void> => {
    setBusy(true)
    try {
      const report = await fetchReport(device)
      await use(report)
      toast.success(message)
    } catch {
      toast.error(t('report.failed'))
    } finally {
      setBusy(false)
    }
  }

  const copy = (): Promise<void> =>
    withReport(async report => {
      await navigator.clipboard.writeText(report.markdown)
    }, t('report.copied'))

  const save = (): Promise<void> =>
    withReport(report => {
      const name = `wiim-hub-${device.name || device.ip}-${fileStamp()}.md`
      download(name, report.markdown, 'text/markdown;charset=utf-8')
    }, t('report.download'))

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {t('findings.title')}
        </h3>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground"
            aria-label={t('report.copy')}
            title={t('report.copy')}
            disabled={busy}
            onClick={() => void copy()}
          >
            <Copy className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 text-muted-foreground"
            aria-label={t('report.download')}
            title={t('report.download')}
            disabled={busy}
            onClick={() => void save()}
          >
            <Download className="size-3" />
          </Button>
        </div>
      </div>

      {findings.length === 0 ? (
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-accent/25 bg-accent/5 px-3 py-2">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-accent" />
          <div className="min-w-0">
            <p data-testid="findings-empty" className="text-xs font-medium text-accent">
              {t('findings.none')}
            </p>
            {checks.length > 0 && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">{checks.join(' · ')}</p>
            )}
            {diagnostics === null && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">{t('findings.pending')}</p>
            )}
            {diagnostics !== null && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {t('findings.readAt', { when: agoLabel(t, diagnostics.at, now) })}
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-1.5">
          {findings.map(finding => (
            <FindingRow key={`${finding.id}-${finding.severity}`} finding={finding} />
          ))}
        </div>
      )}
    </section>
  )
}
