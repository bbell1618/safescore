import { cn } from "@/lib/utils";

type PortalSkeletonVariant =
  | "home"
  | "playbook"
  | "activity"
  | "documents"
  | "account"
  | "list"
  | "onboarding";

function Bone({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return <div className={cn("rounded-md bg-sand", className)} style={style} />;
}

function PageHeadingSkeleton() {
  return (
    <div className="space-y-2">
      <Bone className="h-7 w-44" />
      <Bone className="h-4 w-full max-w-md" />
    </div>
  );
}

function Surface({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border border-sand bg-warm-white p-5 shadow-sm",
        className
      )}
    >
      {children}
    </section>
  );
}

function HomeSkeleton() {
  return (
    <>
      <Surface className="grid min-h-64 gap-8 p-6 lg:grid-cols-2 lg:p-8">
        <div className="space-y-5">
          <Bone className="h-4 w-28" />
          <Bone className="h-16 w-36 rounded-lg" />
          <Bone className="h-6 w-44 rounded-full" />
          <div className="space-y-2">
            <Bone className="h-4 w-full max-w-xl" />
            <Bone className="h-4 w-5/6 max-w-lg" />
          </div>
        </div>
        <div className="flex min-h-44 items-end gap-2 rounded-lg border border-sand bg-cream p-5">
          {[40, 55, 48, 68, 58, 72, 64, 82].map((height, index) => (
            <Bone
              key={`${height}-${index}`}
              className="min-w-0 flex-1"
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      </Surface>

      <Surface className="space-y-5">
        <div className="flex items-center justify-between">
          <Bone className="h-6 w-52" />
          <Bone className="h-4 w-32" />
        </div>
        <div className="space-y-4">
          {[72, 60, 48, 42, 34, 28, 20].map((width, index) => (
            <div
              key={`${width}-${index}`}
              className="grid grid-cols-[7rem_1fr_4rem] items-center gap-4"
            >
              <Bone className="h-4 w-full" />
              <div className="h-2.5 overflow-hidden rounded-full bg-cream">
                <div
                  className="h-full rounded-full bg-sand"
                  style={{ width: `${width}%` }}
                />
              </div>
              <Bone className="h-4 w-full" />
            </div>
          ))}
        </div>
      </Surface>

      <div className="grid gap-6 lg:grid-cols-2">
        <Surface className="space-y-4">
          <Bone className="h-6 w-52" />
          <Bone className="h-16 w-full" />
          <Bone className="h-16 w-full" />
          <Bone className="h-16 w-full" />
        </Surface>
        <Surface className="space-y-4">
          <Bone className="h-6 w-44" />
          <Bone className="h-4 w-full" />
          <Bone className="h-4 w-11/12" />
          <Bone className="h-4 w-4/5" />
        </Surface>
      </div>

      <Surface className="flex flex-wrap items-center justify-between gap-4 py-4">
        <Bone className="h-5 w-52" />
        <Bone className="h-7 w-28 rounded-full" />
      </Surface>
    </>
  );
}

function ActivitySkeleton() {
  return (
    <>
      <PageHeadingSkeleton />
      <Surface className="space-y-5">
        <div className="flex items-center justify-between">
          <Bone className="h-6 w-40" />
          <Bone className="h-4 w-28" />
        </div>
        <Bone className="h-60 w-full rounded-lg" />
      </Surface>
      <Surface className="space-y-4">
        <Bone className="h-6 w-32" />
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="flex items-center justify-between gap-4 border-t border-sand pt-4 first:border-0 first:pt-0"
          >
            <div className="flex-1 space-y-2">
              <Bone className="h-4 w-3/5" />
              <Bone className="h-3 w-2/5" />
            </div>
            <Bone className="h-6 w-24 rounded-full" />
          </div>
        ))}
      </Surface>
      <Surface className="space-y-4">
        <div className="space-y-2">
          <Bone className="h-6 w-40" />
          <Bone className="h-4 w-full max-w-xl" />
        </div>
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="flex items-center justify-between gap-4 border-t border-sand pt-4 first:border-0 first:pt-0"
          >
            <div className="flex-1 space-y-2">
              <Bone className="h-4 w-2/5" />
              <Bone className="h-3 w-3/5" />
              <Bone className="h-3 w-1/3" />
            </div>
            <Bone className="h-6 w-28 rounded-full" />
          </div>
        ))}
      </Surface>
    </>
  );
}

function PlaybookSkeleton() {
  return (
    <>
      <PageHeadingSkeleton />
      <Surface className="space-y-4">
        <Bone className="h-6 w-52" />
        <Bone className="h-4 w-full" />
        <Bone className="h-4 w-5/6" />
      </Surface>
      <div className="space-y-5">
        <div className="space-y-2">
          <Bone className="h-3 w-28" />
          <Bone className="h-7 w-52" />
          <Bone className="h-4 w-full max-w-2xl" />
        </div>
        {[0, 1].map((card) => (
          <Surface key={card} className="overflow-hidden p-0">
            <div className="border-b border-sand bg-cream p-6">
              <div className="flex flex-col justify-between gap-5 xl:flex-row">
                <div className="space-y-3">
                  <Bone className="h-3 w-20" />
                  <Bone className="h-7 w-48" />
                  <Bone className="h-4 w-full max-w-2xl" />
                </div>
                <div className="grid shrink-0 grid-cols-3 gap-3">
                  <Bone className="h-16 w-20" />
                  <Bone className="h-16 w-20" />
                  <Bone className="h-16 w-20" />
                </div>
              </div>
            </div>
            <div className="grid gap-6 p-6 lg:grid-cols-2">
              <div className="space-y-3">
                <Bone className="h-5 w-36" />
                <Bone className="h-4 w-full" />
                <Bone className="h-4 w-5/6" />
                <Bone className="h-24 w-full" />
              </div>
              <div className="space-y-4">
                <Bone className="h-28 w-full" />
                <Bone className="h-28 w-full" />
              </div>
            </div>
          </Surface>
        ))}
      </div>
      <div className="space-y-5">
        <div className="space-y-2">
          <Bone className="h-3 w-28" />
          <Bone className="h-7 w-72" />
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((card) => (
            <Surface key={card} className="space-y-4">
              <Bone className="h-10 w-10" />
              <Bone className="h-5 w-36" />
              <Bone className="h-4 w-full" />
              <Bone className="h-4 w-4/5" />
            </Surface>
          ))}
        </div>
      </div>
      <div className="space-y-5">
        <div className="space-y-2">
          <Bone className="h-3 w-28" />
          <Bone className="h-7 w-80" />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((card) => (
            <Surface key={card} className="space-y-4">
              <Bone className="h-6 w-44" />
              <Bone className="h-4 w-full" />
              <Bone className="h-4 w-5/6" />
              <Bone className="h-16 w-full" />
            </Surface>
          ))}
        </div>
      </div>
    </>
  );
}

function DocumentsSkeleton() {
  return (
    <>
      <PageHeadingSkeleton />
      {[0, 1, 2].map((section) => (
        <Surface key={section} className="space-y-4">
          <div className="space-y-2">
            <Bone className="h-6 w-48" />
            <Bone className="h-4 w-full max-w-lg" />
          </div>
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex items-center gap-4 rounded-lg border border-sand bg-cream p-4"
            >
              <Bone className="h-10 w-10 shrink-0" />
              <div className="flex-1 space-y-2">
                <Bone className="h-4 w-2/5" />
                <Bone className="h-3 w-1/4" />
              </div>
              <Bone className="h-8 w-24" />
            </div>
          ))}
        </Surface>
      ))}
    </>
  );
}

function AccountSkeleton() {
  return (
    <div className="max-w-2xl space-y-6">
      <PageHeadingSkeleton />
      {[0, 1, 2, 3].map((card) => (
        <Surface key={card} className="space-y-4">
          <Bone className="h-6 w-44" />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Bone className="h-3 w-24" />
              <Bone className="h-5 w-40" />
            </div>
            <div className="space-y-2">
              <Bone className="h-3 w-20" />
              <Bone className="h-5 w-32" />
            </div>
          </div>
        </Surface>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <>
      <PageHeadingSkeleton />
      <Surface className="space-y-4">
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="flex items-center justify-between gap-4 border-t border-sand pt-4 first:border-0 first:pt-0"
          >
            <div className="flex-1 space-y-2">
              <Bone className="h-4 w-1/2" />
              <Bone className="h-3 w-3/4" />
            </div>
            <Bone className="h-7 w-24 rounded-full" />
          </div>
        ))}
      </Surface>
    </>
  );
}

function OnboardingSkeleton() {
  return (
    <Surface className="mx-auto max-w-2xl space-y-6 p-6 sm:p-8">
      <div className="space-y-3 text-center">
        <Bone className="mx-auto h-10 w-10 rounded-full" />
        <Bone className="mx-auto h-7 w-56" />
        <Bone className="mx-auto h-4 w-full max-w-md" />
      </div>
      <div className="space-y-4">
        <Bone className="h-12 w-full" />
        <Bone className="h-12 w-full" />
        <Bone className="h-12 w-full" />
      </div>
      <Bone className="h-10 w-full" />
    </Surface>
  );
}

export function PortalRouteSkeleton({
  variant = "list",
}: {
  variant?: PortalSkeletonVariant;
}) {
  return (
    <div
      className="space-y-6 motion-safe:animate-pulse"
      role="status"
      aria-label="Loading portal content"
    >
      {variant === "home" && <HomeSkeleton />}
      {variant === "playbook" && <PlaybookSkeleton />}
      {variant === "activity" && <ActivitySkeleton />}
      {variant === "documents" && <DocumentsSkeleton />}
      {variant === "account" && <AccountSkeleton />}
      {variant === "list" && <ListSkeleton />}
      {variant === "onboarding" && <OnboardingSkeleton />}
      <span className="sr-only">Loading…</span>
    </div>
  );
}
