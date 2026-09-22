export type BillableDriverSource =
  | "client_stated"
  | "fmcsa_mcs150"
  | "attested"
  | "active_roster";

export type BillableDriverCount = {
  billable: number | null;
  winningSource: BillableDriverSource | null;
  sources: {
    source: BillableDriverSource;
    value: number | null;
    asOf: string | null;
  }[];
};
