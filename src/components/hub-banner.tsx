import { RefreshCw, ServerCrash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { agoLabel } from '@/lib/labels'
import { useSettings } from '@/lib/settings'

// `since` is when the state on screen was received, and only matters while the
// hub is silent: the cards below still hold it, so the banner's job is to say
// that, and how old it is, rather than let a stale volume pass for the live one.
export const HubBanner = ({
  onRetry,
  since,
  now,
}: Readonly<{ onRetry: () => void; since: number | null; now: number }>) => {
  const { t, resolvedLang } = useSettings()
  return (
    <Card className="flex flex-col gap-4 border-danger/30 bg-danger/5 p-5 sm:flex-row sm:items-center">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-danger/10 text-danger">
        <ServerCrash className="size-5" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{t('hubDown')}</p>
        <p className="text-xs text-muted-foreground">
          {since === null
            ? t('hubDownHint')
            : t('hubStale', { age: agoLabel(t, resolvedLang, since, now) })}
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="size-3.5" />
        {t('retry')}
      </Button>
    </Card>
  )
}
