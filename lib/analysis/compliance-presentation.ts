function pluralize(count: number, singular: string, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

export function formatComplianceBasis(
  onFileCount: number,
  inWindowCount: number
): string {
  const agedOutCount = Math.max(onFileCount - inWindowCount, 0);

  return `Counts all on-file violations \u2014 audit exposure is not limited to the 24-month scoring window. ${onFileCount} ${pluralize(onFileCount, "violation")} on file \u00B7 ${inWindowCount} in scoring window \u00B7 ${agedOutCount} aged out but audit-relevant.`;
}

export function formatComplianceIssueStatus(
  onFileCount: number,
  inWindowCount: number
): string {
  const agedOutCount = Math.max(onFileCount - inWindowCount, 0);
  const onFile = `${onFileCount} ${pluralize(onFileCount, "issue")} on file`;

  if (agedOutCount === 0) {
    return `Needs review - ${onFile}`;
  }

  return `Needs review - ${onFile} \u00B7 ${inWindowCount} in scoring window, ${agedOutCount} aged out but audit-relevant`;
}
