import { AudioLines, RefreshCw, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useSettings } from '@/lib/settings'

export const EmptyState = ({
  onDiscover,
  discovering,
}: Readonly<{ onDiscover: () => void; discovering: boolean }>) => {
  const { t } = useSettings()
  return (
    <Card className="flex flex-col items-center gap-4 border-dashed bg-card/40 px-6 py-16 text-center">
      <span className="grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
        <SearchX className="size-6" />
      </span>
      <div className="space-y-1">
        <p className="text-base font-medium">{t('empty')}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{t('emptyHint')}</p>
      </div>
      <Button variant="outline" onClick={onDiscover} disabled={discovering}>
        {discovering ? (
          <RefreshCw className="size-4 animate-spin" />
        ) : (
          <AudioLines className="size-4" />
        )}
        {discovering ? t('discovering') : t('discover')}
      </Button>
    </Card>
  )
}
