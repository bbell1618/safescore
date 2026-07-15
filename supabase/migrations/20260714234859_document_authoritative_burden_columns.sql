comment on column public.violations.severity_weight is
  'FMCSA Appendix A severity input. Authoritative as an input only; do not treat severity_weight * stored time_weight as SafeScore burden.';

comment on column public.violations.time_weight is
  'Import-time cache that ages and is non-authoritative. SafeScore burden recomputes the current 1/2/3 time weight from inspections.inspection_date on every read.';

comment on column public.violations.oos_violation is
  'FMCSA OOS flag. Authoritative SafeScore burden adds the SMS +2 OOS severity before multiplying by the current time weight.';

comment on column public.burden_snapshots.total_points is
  'Authoritative point-in-time SafeScore burden: current time weight * (severity_weight + 2 when OOS), computed from canonical inspections.';
