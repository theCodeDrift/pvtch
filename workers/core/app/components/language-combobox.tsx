import { useState, useMemo } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  SUPPORTED_TARGET_LANGUAGES,
  findSupportedTargetLanguage,
  type SupportedTargetLanguage,
} from '@pvtch/shared/supported-languages';

interface LanguageComboboxProps {
  id?: string;
  name?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
}

function tierLabel(tier: SupportedTargetLanguage['tier']): string {
  return tier === 'ensemble' ? 'Best supported' : 'Limited accuracy';
}

export function LanguageCombobox({
  id,
  name,
  value,
  onChange,
  onBlur,
}: LanguageComboboxProps) {
  const [open, setOpen] = useState(false);

  // The form stores the canonical lowercase name (e.g. "english"). Look it up
  // so we can show the user-friendly display while still emitting the
  // canonical name on change.
  const selected = useMemo(
    () => (value ? findSupportedTargetLanguage(value) : undefined),
    [value]
  );

  const buttonLabel = selected
    ? `${selected.name} (${selected.iso639_1}/${selected.iso639_3})`
    : value || 'Select a language…';

  return (
    <>
      {/* Hidden input keeps the value in the surrounding <form> so server-side
          form parsing still sees `language=<name>` exactly like the prior text
          input did. */}
      {name && <input type="hidden" name={name} value={value} />}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-normal"
            onBlur={onBlur}
          >
            <span className={cn(!value && 'text-muted-foreground')}>
              {buttonLabel}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0">
          <Command
            filter={(itemValue, search) => {
              // CommandItem's `value` is set to "<name> <iso1> <iso3>" below,
              // so substring-matching covers all three forms uniformly.
              return itemValue.toLowerCase().includes(search.toLowerCase())
                ? 1
                : 0;
            }}
          >
            <CommandInput placeholder="Search language or code…" />
            <CommandList>
              <CommandEmpty>No supported language matches.</CommandEmpty>
              <CommandGroup>
                {SUPPORTED_TARGET_LANGUAGES.map((lang) => {
                  const isSelected = selected?.iso639_3 === lang.iso639_3;
                  const itemValue = `${lang.name} ${lang.iso639_1} ${lang.iso639_3}`;
                  return (
                    <CommandItem
                      key={lang.iso639_3}
                      value={itemValue}
                      onSelect={() => {
                        onChange(lang.name);
                        setOpen(false);
                      }}
                    >
                      <Check
                        className={cn(
                          'mr-2 h-4 w-4',
                          isSelected ? 'opacity-100' : 'opacity-0'
                        )}
                      />
                      <span className="flex-1 capitalize">{lang.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {lang.iso639_1} · {lang.iso639_3}
                      </span>
                      <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                        {tierLabel(lang.tier)}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}
