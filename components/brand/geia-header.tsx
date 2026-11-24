/** QF-227: the Golden Era header for the sign-up steps, matching the menu bar inside the account. */
export function GeiaHeader({ subtitle }: { subtitle?: string }) {
  return (
    <header className="border-b border-white/10 bg-[#0F1B2D] text-white shadow-[0_2px_6px_rgba(15,27,45,0.18)]">
      <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- static brand file, already sized */}
        <img src="/brand/lockup-nav.webp" alt="Golden Era Insurance Agency" width={785} height={176} className="h-9 w-auto" />
        <span aria-hidden className="hidden h-7 w-px bg-white/20 sm:block" />
        <div className="hidden min-w-0 sm:block">
          <p className="text-[15px] font-semibold leading-tight">SafeScore</p>
          {subtitle ? <p className="truncate text-xs text-white/70">{subtitle}</p> : null}
        </div>
      </div>
    </header>
  );
}

/** The round Golden Era badge, for small centered cards (sign in, links). */
export function GeiaBadge({ className = "h-14 w-14" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element -- static brand file
  return <img src="/brand/badge.webp" alt="Golden Era Insurance Agency" width={160} height={160} className={`mx-auto rounded-full ${className}`} />;
}
