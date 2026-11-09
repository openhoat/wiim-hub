import { Check, Pencil, Plus, Server, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  addHost,
  fetchHosts,
  type HostEntry,
  type HostSource,
  removeHost,
  renameHost,
} from '@/lib/api'
import { useSettings } from '@/lib/settings'

// The address is the identity, the name is what the speaker calls itself: show
// the second one alone when they agree, both when a lease moved the address.
const entryLabel = (entry: HostEntry, offline: string): string => {
  if (!entry.online) return offline
  return entry.ip === entry.host ? entry.name : `${entry.name} · ${entry.ip}`
}

const sourceVariant: Record<HostSource, 'accent' | 'default' | 'warning'> = {
  env: 'accent',
  saved: 'default',
  discovered: 'warning',
}

// The list is read when the dialog opens, not on the poll: it changes when
// someone acts on it, and every write answers the list it produced.
export const HostsDialog = ({ onChanged }: Readonly<{ onChanged: () => void }>) => {
  const { t } = useSettings()
  const [open, setOpen] = useState(false)
  const [hosts, setHosts] = useState<HostEntry[] | null>(null)
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState<{ from: string; value: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let live = true
    setError(null)
    fetchHosts()
      .then(answer => {
        if (live) setHosts(answer.hosts)
      })
      .catch((cause: unknown) => {
        if (live) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      live = false
    }
  }, [open])

  // One action at a time: two writes racing on the same file would leave the
  // dialog showing a list the server no longer has.
  const run = async (action: () => Promise<{ hosts: HostEntry[] }>, done?: () => void) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const answer = await action()
      setHosts(answer.hosts)
      done?.()
      onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const submitDraft = (): void => {
    const host = draft.trim()
    if (host === '') return
    void run(
      () => addHost(host),
      () => setDraft('')
    )
  }

  const submitEdit = (): void => {
    if (editing === null) return
    const to = editing.value.trim()
    if (to === '' || to === editing.from) {
      setEditing(null)
      return
    }
    void run(
      () => renameHost(editing.from, to),
      () => setEditing(null)
    )
  }

  const field =
    'h-8 min-w-0 flex-1 rounded-lg border border-border bg-transparent px-2 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-accent/50'

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('hosts.open')} title={t('hosts.open')}>
          <Server className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={t('hosts.close')}>
        <DialogTitle className="text-sm font-medium">{t('hosts.title')}</DialogTitle>
        <DialogDescription className="mt-1 text-[11px] text-muted-foreground">
          {t('hosts.hint')}
        </DialogDescription>

        <form
          className="mt-4 flex items-center gap-2"
          onSubmit={event => {
            event.preventDefault()
            submitDraft()
          }}
        >
          <input
            value={draft}
            inputMode="url"
            spellCheck={false}
            placeholder={t('hosts.placeholder')}
            aria-label={t('hosts.address')}
            onChange={event => setDraft(event.currentTarget.value)}
            className={field}
          />
          <Button
            type="submit"
            size="sm"
            disabled={busy || draft.trim() === ''}
            className="gap-1.5"
          >
            <Plus className="size-3.5" />
            {t('hosts.add')}
          </Button>
        </form>

        <ul className="mt-3 divide-y divide-border/60">
          {(hosts ?? []).map(entry => (
            <li key={entry.host} className="flex items-center gap-2 py-2">
              <span
                aria-hidden
                className={`size-1.5 shrink-0 rounded-full ${
                  entry.online ? 'bg-accent' : 'bg-muted-foreground/40'
                }`}
              />
              {editing !== null && editing.from === entry.host ? (
                <>
                  <input
                    value={editing.value}
                    spellCheck={false}
                    aria-label={t('hosts.newAddress')}
                    onChange={event =>
                      setEditing({ from: entry.host, value: event.currentTarget.value })
                    }
                    className={field}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('hosts.save')}
                    title={t('hosts.save')}
                    disabled={busy}
                    onClick={submitEdit}
                  >
                    <Check className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('hosts.cancel')}
                    title={t('hosts.cancel')}
                    onClick={() => setEditing(null)}
                  >
                    <X className="size-4" />
                  </Button>
                </>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-xs">{entry.host}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {entryLabel(entry, t('offline'))}
                    </p>
                  </div>
                  <Badge variant={sourceVariant[entry.source]}>
                    {t(`hosts.source.${entry.source}`)}
                  </Badge>
                  {entry.source === 'discovered' && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('hosts.keep')}
                      title={t('hosts.keep')}
                      disabled={busy}
                      onClick={() => void run(() => addHost(entry.host))}
                    >
                      <Plus className="size-4" />
                    </Button>
                  )}
                  {entry.source === 'saved' && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('hosts.rename')}
                        title={t('hosts.rename')}
                        disabled={busy}
                        onClick={() => setEditing({ from: entry.host, value: entry.host })}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('hosts.remove')}
                        title={t('hosts.remove')}
                        disabled={busy}
                        onClick={() => void run(() => removeHost(entry.host))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>

        {hosts !== null && hosts.length === 0 && (
          <p className="mt-2 text-[11px] text-muted-foreground">{t('hosts.empty')}</p>
        )}

        <p
          role="status"
          aria-live="polite"
          className={error === null ? 'sr-only' : 'mt-2 text-[11px] text-warning'}
        >
          {error === null ? '' : t('hosts.failed', { reason: error })}
        </p>
      </DialogContent>
    </Dialog>
  )
}
