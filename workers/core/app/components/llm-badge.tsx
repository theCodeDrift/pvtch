import { Link } from 'react-router';
import { Sparkles } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** Marks a feature that uses an LLM, linking to the page that says how. Put
 * it on every feature /llm lists, and only those. */
export function LlmBadge({ className }: { className?: string }) {
  return (
    <Badge
      asChild
      variant="outline"
      className={cn('gap-1 font-medium', className)}
    >
      <Link
        to="/llm"
        title="This feature uses a large language model. Read how PVTCH uses LLMs."
      >
        <Sparkles aria-hidden="true" />
        LLM powered
      </Link>
    </Badge>
  );
}
