import { SectionDivider } from "@/components/ui/section-divider";
import { cn } from "@/lib/utils";
import Link from "next/link";
import type { ReactNode } from "react";

const NAVY = "var(--color-navy)";
const TEXTURED_WARM = "transparent";

interface PortalHeroBandProps {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function PortalHeroBand({
  eyebrow,
  title,
  description,
  children,
  className,
  contentClassName,
}: PortalHeroBandProps) {
  return (
    <header
      className={cn(
        "portal-navy-texture overflow-hidden text-warm-white shadow-[var(--shadow-md)]",
        className
      )}
    >
      <div
        className={cn(
          "mx-auto w-full max-w-7xl px-4 py-12 sm:px-6 sm:py-14 lg:py-16",
          contentClassName
        )}
      >
        <p className="mono-label text-gold-light">{eyebrow}</p>
        <h1 className="mt-2 max-w-4xl font-heading text-4xl font-semibold tracking-tight text-warm-white sm:text-5xl">
          {title}
        </h1>
        {description ? (
          <div className="mt-3 max-w-3xl text-sm leading-6 text-warm-white/80 sm:text-base">
            {description}
          </div>
        ) : null}
        {children}
      </div>
    </header>
  );
}

interface PortalSectionDividerProps {
  transition?: "navy-to-warm" | "warm-to-navy";
  variant?: "curve" | "wave" | "angle";
  className?: string;
}

export function PortalSectionDivider({
  transition = "navy-to-warm",
  variant = "curve",
  className,
}: PortalSectionDividerProps) {
  const navyToWarm = transition === "navy-to-warm";

  return (
    <SectionDivider
      fromColor={navyToWarm ? NAVY : TEXTURED_WARM}
      toColor={navyToWarm ? TEXTURED_WARM : NAVY}
      variant={variant}
      className={cn("shrink-0", className)}
    />
  );
}

interface PortalPageBodyProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function PortalPageBody({
  children,
  className,
  contentClassName,
}: PortalPageBodyProps) {
  return (
    <section className={cn("portal-warm-texture", className)}>
      <div
        className={cn(
          "mx-auto w-full max-w-7xl px-4 py-10 sm:px-6 lg:py-12",
          contentClassName
        )}
      >
        {children}
      </div>
    </section>
  );
}

interface PortalFooterBandProps {
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function PortalFooterBand({
  children,
  className,
  contentClassName,
}: PortalFooterBandProps) {
  return (
    <footer
      className={cn(
        "portal-navy-texture text-warm-white",
        className
      )}
    >
      <div
        className={cn(
          "mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-6 sm:px-6",
          contentClassName
        )}
      >
        {children}
        <Link
          href="/terms"
          className="ml-auto inline-flex min-h-10 shrink-0 items-center text-xs text-warm-white/70 underline decoration-warm-white/35 underline-offset-4 transition-colors hover:text-warm-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          Terms of Service
        </Link>
      </div>
    </footer>
  );
}
