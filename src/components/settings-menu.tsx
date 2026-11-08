import { Monitor, Moon, Settings2, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSettings, type Lang, type Theme } from '@/lib/settings'

const languages: { value: Lang; labelKey: string }[] = [
  { value: 'auto', labelKey: 'auto' },
  { value: 'en', labelKey: 'langName.en' },
  { value: 'fr', labelKey: 'langName.fr' },
]

const themes: { value: Theme; labelKey: string; icon: typeof Monitor }[] = [
  { value: 'auto', labelKey: 'auto', icon: Monitor },
  { value: 'dark', labelKey: 'dark', icon: Moon },
  { value: 'light', labelKey: 'light', icon: Sun },
]

export const SettingsMenu = () => {
  const { t, lang, theme, setLang, setTheme } = useSettings()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('settings')}>
          <Settings2 className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t('language')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={lang} onValueChange={(value) => setLang(value as Lang)}>
          {languages.map((item) => (
            <DropdownMenuRadioItem key={item.value} value={item.value}>
              {t(item.labelKey)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>{t('theme')}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)}>
          {themes.map((item) => {
            const Icon = item.icon
            return (
              <DropdownMenuRadioItem key={item.value} value={item.value}>
                <span className="flex items-center gap-2">
                  <Icon className="size-3.5" />
                  {t(item.labelKey)}
                </span>
              </DropdownMenuRadioItem>
            )
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
