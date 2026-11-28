import { useMemo, useState } from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
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
import { FEATURED_FONTS, FONT_NAME, googleFontHref } from '@/lib/flagbanner';
import catalogJson from '@/lib/google-fonts.json';

/** [family, category letter, upright weights in hundreds], most popular first. */
type CatalogEntry = [string, string, string];
const CATALOG = catalogJson as CatalogEntry[];

const CATEGORY_LABELS: Record<string, string> = {
  s: 'Sans Serif',
  e: 'Serif',
  d: 'Display',
  h: 'Handwriting',
  m: 'Monospace',
};

const SAMPLE = 'Happy Birthday';
/** Rows rendered at a time; scrolling near the end renders the next page. */
const PAGE = 80;

/** Upright weights (100 to 900) a catalog family ships, if it is listed. */
export const weightsFor = (family: string): number[] | undefined => {
  const entry = CATALOG.find(
    ([name]) => name.toLowerCase() === family.trim().toLowerCase()
  );
  return entry ? [...entry[2]].map((digit) => Number(digit) * 100) : undefined;
};

/** A family's display font-family, with a neutral fallback while it loads. */
const fontStack = (family: string) => `'${family}', system-ui, sans-serif`;

function FontStylesheet({ family }: { family: string }) {
  // No `precedence`: React would treat it as a blocking resource, and a
  // family Google doesn't know would throw instead of just not loading.
  return <link rel="stylesheet" href={googleFontHref(family)} />;
}

interface FontPickerProps {
  value: string;
  onChange: (family: string) => void;
}

/**
 * Four featured looks rendered in their own typefaces, plus a searchable list
 * of every Google font. Anything typed can be used as-is, so fonts newer than
 * the bundled catalog still work.
 */
export function FontPicker({ value, onChange }: FontPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [highlighted, setHighlighted] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const matches = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return CATALOG;
    // names that start with the query first, then the rest that contain it
    const starts: CatalogEntry[] = [];
    const contains: CatalogEntry[] = [];
    for (const entry of CATALOG) {
      const name = entry[0].toLowerCase();
      if (name.startsWith(query)) starts.push(entry);
      else if (name.includes(query)) contains.push(entry);
    }
    return [...starts, ...contains];
  }, [search]);

  const typed = search.trim().replaceAll(/\s+/g, ' ');
  const canUseTyped =
    FONT_NAME.test(typed) &&
    !matches.some(([name]) => name.toLowerCase() === typed.toLowerCase());

  const updateSearch = (next: string) => {
    setSearch(next);
    setLimit(PAGE);
  };

  const choose = (family: string) => {
    onChange(family);
    setOpen(false);
    updateSearch('');
  };

  const isFeatured = FEATURED_FONTS.some(({ family }) => family === value);
  const previewFamily = highlighted.startsWith('use:')
    ? highlighted.slice(4)
    : highlighted;

  return (
    <div className="flex flex-col gap-3">
      {FEATURED_FONTS.map(({ family }) => (
        <FontStylesheet key={family} family={family} />
      ))}
      {value && <FontStylesheet family={value} />}

      <div className="grid grid-cols-2 gap-2">
        {FEATURED_FONTS.map(({ label, family }) => (
          <button
            key={family}
            type="button"
            onClick={() => onChange(family)}
            aria-pressed={value === family}
            className={cn(
              'rounded-md border px-3 py-2 text-left transition-colors hover:bg-accent',
              value === family && 'border-primary ring-1 ring-primary'
            )}
          >
            <div className="text-xs text-muted-foreground">
              {label} · {family}
            </div>
            <div
              className="truncate text-xl"
              style={{ fontFamily: fontStack(family) }}
            >
              {SAMPLE}
            </div>
          </button>
        ))}
      </div>

      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) updateSearch('');
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'w-full justify-between font-normal',
              !isFeatured && value && 'border-primary ring-1 ring-primary'
            )}
          >
            <span className="truncate">
              {isFeatured || !value ? (
                <span className="text-muted-foreground">
                  Search all Google Fonts…
                </span>
              ) : (
                <span style={{ fontFamily: fontStack(value) }}>{value}</span>
              )}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) p-0">
          <Command
            shouldFilter={false}
            value={highlighted}
            onValueChange={setHighlighted}
          >
            <CommandInput
              placeholder={`Search ${CATALOG.length} fonts or type any name…`}
              value={search}
              onValueChange={updateSearch}
            />
            <CommandList
              className="max-h-72"
              onScroll={(event) => {
                const list = event.currentTarget;
                const nearEnd =
                  list.scrollTop + list.clientHeight > list.scrollHeight - 200;
                if (nearEnd && limit < matches.length) {
                  setLimit(limit + PAGE);
                }
              }}
            >
              {matches.length === 0 && !canUseTyped && (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  Font names use letters, numbers and spaces.
                </div>
              )}
              <CommandGroup>
                {matches.slice(0, limit).map(([family, category]) => (
                  <CommandItem
                    key={family}
                    value={family}
                    onSelect={() => choose(family)}
                  >
                    <Check
                      className={cn(
                        'mr-2 h-4 w-4',
                        value === family ? 'opacity-100' : 'opacity-0'
                      )}
                    />
                    <span className="flex-1 truncate">{family}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {CATEGORY_LABELS[category] ?? ''}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
              {canUseTyped && (
                <CommandGroup>
                  <CommandItem
                    value={`use:${typed}`}
                    onSelect={() => choose(typed)}
                  >
                    <span className="mr-2 h-4 w-4" />
                    Use &ldquo;{typed}&rdquo;
                  </CommandItem>
                </CommandGroup>
              )}
            </CommandList>
            {/* load only the highlighted family, so browsing stays cheap */}
            {open && previewFamily && FONT_NAME.test(previewFamily) && (
              <div className="border-t px-3 py-2">
                <FontStylesheet family={previewFamily} />
                <div className="text-xs text-muted-foreground">
                  {previewFamily}
                </div>
                <div
                  className="truncate text-2xl"
                  style={{ fontFamily: fontStack(previewFamily) }}
                >
                  {SAMPLE}
                </div>
              </div>
            )}
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
