import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { charmCardText, type CharmState } from "@/lib/tracker-shelf";

// The Charm Challenge on the Trackers shelf (spec 2026-10-21, "Notebook card"): the days to go as
// the big number, the day it is done, restarts and longest run, and a way to the record of every
// start, reset, kept answer and finish (the collection's own page). It is not a habit: no "I did
// it", no streak. The card language is the habit card's (pages/Collections.tsx HabitCard): same
// card, icon tile, title, muted line, type scale. The whole card opens the record; the one link in
// it is "See the record", so a screen reader hears the card as sentences and one named link.
export function CharmCard({ collection, charm }: { collection: { slug: string; icon?: string | null }; charm: CharmState | null }) {
  const text = charmCardText(charm);
  return (
    <Card className="relative transition-colors hover:bg-accent/50 has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-ring has-[a:focus-visible]:ring-offset-2">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden="true">{collection.icon && /^\p{Emoji}/u.test(collection.icon) ? collection.icon : "✨"}</div>
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-base">Charm Challenge</CardTitle>
            <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">21 days of charming the AI instead of arguing with it</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-2 space-y-1 text-sm">
          {text.big !== null && (
            <>
              {text.spoken && <p className="sr-only">{text.spoken}</p>}
              <p className="flex flex-wrap items-baseline gap-x-2" aria-hidden={text.spoken ? true : undefined}>
                <span className={text.quiet ? "text-xl font-semibold leading-tight font-display" : "text-3xl font-bold leading-tight font-display tabular-nums"}>{text.big}</span>
                {text.unit && <span className="font-medium">{text.unit}</span>}
              </p>
            </>
          )}
          {text.after && <p aria-hidden={text.big !== null && text.spoken ? true : undefined}>{text.after}</p>}
          {text.hint && <p className="text-muted-foreground">{text.hint}</p>}
          {text.stats && (
            <>
              <p className="sr-only">{text.stats.spoken}</p>
              <p aria-hidden="true">{text.stats.shown}</p>
            </>
          )}
        </div>
        <Link
          to={`/collections/${collection.slug}`}
          className="text-xs font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none after:absolute after:inset-0 after:rounded-xl after:content-['']"
        >
          See the record<span className="sr-only"> of the Charm Challenge</span>
        </Link>
      </CardContent>
    </Card>
  );
}
