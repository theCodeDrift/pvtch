import { useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import { Loader, RefreshCw } from 'lucide-react';
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

type RotateResult = { ok: true } | { error: string };

/**
 * Replace the signed-in user's overlay key, after a confirmation, through
 * POST /account/token/rotate.
 */
export function RotateOverlayKey() {
  const fetcher = useFetcher<RotateResult>();
  const [open, setOpen] = useState(false);
  const busy = fetcher.state !== 'idle';

  useEffect(() => {
    if (fetcher.state !== 'idle' || !fetcher.data) return;
    if ('ok' in fetcher.data) {
      toast.success('Overlay key rotated. Update your overlay URLs.');
    } else {
      toast.error(fetcher.data.error);
    }
    setOpen(false);
  }, [fetcher.state, fetcher.data]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <RefreshCw className="h-4 w-4" />
          Rotate overlay key
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotate your overlay key?</DialogTitle>
          <DialogDescription>
            Every overlay and API URL using your current key stops working right
            away, and you are signed out on your other browsers. You will need
            to copy the new URLs into OBS and your bots.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() =>
              void fetcher.submit(
                {},
                { method: 'POST', action: '/account/token/rotate' }
              )
            }
          >
            {busy && <Loader className="h-4 w-4 animate-spin" />}
            Rotate key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
