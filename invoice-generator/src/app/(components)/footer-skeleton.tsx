import { FooterLaunchBadges } from "@/app/(components)/footer-launch-badges";
import { Skeleton } from "@/components/ui/skeleton";

export function FooterSkeleton() {
  return (
    <footer className="w-full border-t border-slate-200 bg-white py-12 md:py-16">
      <div className="container mx-auto px-4 md:px-6">
        {/* Top content */}
        <div className="flex flex-col gap-10 md:flex-row">
          <div className="space-y-4 md:w-1/3">
            <div className="flex items-center gap-2">
              <Skeleton className="size-8" />
              <Skeleton className="h-7 w-40" />
            </div>
            <Skeleton className="h-16 w-full" />
            <div className="flex gap-4">
              <Skeleton className="size-5" />
              <Skeleton className="size-5" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-10 md:ml-20 md:flex-1 md:grid-cols-2">
            <div className="space-y-5">
              <Skeleton className="h-5 w-24" />
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-4 w-40" />
                ))}
              </div>
            </div>
            <div className="space-y-5">
              <Skeleton className="h-5 w-24" />
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                {Array.from({ length: 2 }).map((_, columnIndex) => (
                  <div key={columnIndex} className="space-y-2">
                    <Skeleton className="h-4 w-20" />
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-4 w-32" />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* LAUNCH Badges */}
        <div className="mb-7 mt-10 flex flex-wrap items-center gap-3">
          <FooterLaunchBadges />
        </div>

        {/* Bottom links */}
        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-slate-200 pt-8 md:flex-row">
          <Skeleton className="h-4 w-48" />
          <div className="flex items-center gap-1.5">
            <Skeleton className="size-6 rounded-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
      </div>
    </footer>
  );
}
