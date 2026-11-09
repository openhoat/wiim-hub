import { RefreshCw } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useSettings } from '@/lib/settings'
import { applyUpdate, subscribeUpdates, updateReady } from '@/lib/updates'

// A deploy reaches an installed app on its next launch, because the document is
// served network first. This banner covers the other case: a window that stayed
// open, where the new worker is waiting and the code on screen is the old one.
//
// The reload is offered rather than forced: the page may be in the middle of a
// rename or a volume change, and a banner costs one click against a control that
// disappears under the hand. Reloading keeps the view, the language and the last
// state, so nothing else is lost.
export const UpdateBanner = () => {
  const { t } = useSettings()
  const ready = useSyncExternalStore(subscribeUpdates, updateReady)
  if (!ready) return null
  return (
    <Card className="flex flex-col gap-3 border-accent/30 bg-accent/5 p-4 sm:flex-row sm:items-center">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
        <RefreshCw className="size-4" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-sm font-medium">{t('update.ready')}</p>
        <p className="text-xs text-muted-foreground">{t('update.hint')}</p>
      </div>
      <Button variant="outline" size="sm" onClick={applyUpdate}>
        <RefreshCw className="size-3.5" />
        {t('update.reload')}
      </Button>
    </Card>
  )
}
