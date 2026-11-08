import { RefreshCw, ServerCrash } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useSettings } from '@/lib/settings'

export const HubBanner = ({ onRetry }: Readonly<{ onRetry: () => void }>) => {
  const { t } = useSettings()
  return (
    <Card className="flex flex-col gap-4 border-danger/30 bg-danger/5 p-5 sm:flex-row sm:items-center">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-danger/10 text-danger">
        <ServerCrash className="size-5" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{t('hubDown')}</p>
        <p className="text-xs text-muted-foreground">{t('hubDownHint')}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="size-3.5" />
        {t('retry')}
      </Button>
    </Card>
  )
}
