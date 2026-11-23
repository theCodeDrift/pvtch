import { useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { Loader, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

type EndSessionsResult = { ok: true } | { error: string };

/**
 * Sign out of every other browser, after a confirmation, through
 * POST /account/sessions/end. This browser stays signed in.
 */
export function SignOutEverywhere() {
  const fetcher = useFetcher<EndSessionsResult>();
  const [open, setOpen] = useState(false);
  const busy = fetcher.state !== 'idle';

  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    if ('ok' in fetcher.data) {
      toast.success('Signed out of your other browsers.');
    } else {
      toast.error(fetcher.data.error);
    }
    setOpen(false);
  }, [fetcher.state, fetcher.data]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <LogOut className="h-4 w-4" />
          Sign out everywhere
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sign out of every other browser?</DialogTitle>
          <DialogDescription>
            Every other browser and device signed in to your PVTCH account is
            signed out. You stay signed in here, and your overlays keep working.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            disabled={busy}
            onClick={() =>
              void fetcher.submit(
                {},
                { method: 'POST', action: '/account/sessions/end' }
              )
            }
          >
            {busy && <Loader className="h-4 w-4 animate-spin" />}
            Sign out everywhere
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
