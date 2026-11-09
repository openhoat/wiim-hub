import { AudioLines, RefreshCw } from 'lucide-react'
import { HostsDialog } from '@/components/hosts-dialog'
import { SettingsMenu } from '@/components/settings-menu'
import { Button } from '@/components/ui/button'
import { ViewSwitch } from '@/components/view-switch'
import { useSettings } from '@/lib/settings'
import type { View } from '@/lib/types'

type HeaderProps = {
  view: View
  onChangeView: (view: View) => void
  onDiscover: () => void
  onHostsChanged: () => void
  discovering: boolean
  online: number
  total: number
}

export const Header = ({
  view,
  onChangeView,
  onDiscover,
  onHostsChanged,
  discovering,
  online,
  total,
}: Readonly<HeaderProps>) => {
  const { t } = useSettings()
  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent/15 text-accent">
            <AudioLines className="size-4" strokeWidth={2.2} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm leading-tight font-semibold tracking-tight">
              {t('title')}
            </p>
            <p className="hidden truncate text-[11px] text-muted-foreground sm:block">
              {total === 0 ? t('empty') : t('deviceSummary', { online, total })}
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <ViewSwitch view={view} onChange={onChangeView} />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('discover')}
            title={t('discover')}
            onClick={onDiscover}
            disabled={discovering}
          >
            <RefreshCw className={discovering ? 'size-4 animate-spin' : 'size-4'} />
          </Button>
          <HostsDialog onChanged={onHostsChanged} />
          <SettingsMenu />
        </div>
      </div>
    </header>
  )
}
