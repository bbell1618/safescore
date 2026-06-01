export interface ReasonCodeResult {
  code: 'violation_incorrect' | 'company_incorrect' | 'driver_incorrect' | 'inspection_missing' | 'duplicate' | 'other'
  label: string
  description: string
}

export const ALL_REASON_CODES: ReasonCodeResult[] = [
  {
    code: 'violation_incorrect',
    label: 'The violation/conviction is incorrect',
    description: 'The cited violation or conviction did not occur as recorded or the details are factually wrong.',
  },
  {
    code: 'company_incorrect',
    label: 'Wrong carrier / incorrect DOT number',
    description: 'The inspection or violation was attributed to the wrong company or DOT number.',
  },
  {
    code: 'driver_incorrect',
    label: 'Wrong driver / incorrect CDL',
    description: 'The violation was attributed to the wrong driver or an incorrect CDL number was recorded.',
  },
  {
    code: 'inspection_missing',
    label: 'The inspection never occurred',
    description: 'No inspection took place at the reported location and time.',
  },
  {
    code: 'duplicate',
    label: 'Duplicate of another record',
    description: 'This record is a duplicate of an existing inspection or violation already on file.',
  },
  {
    code: 'other',
    label: 'Other reason',
    description: 'The basis for challenge does not fit any of the standard FMCSA categories.',
  },
]

const REASON_CODE_MAP = new Map<ReasonCodeResult['code'], ReasonCodeResult>(
  ALL_REASON_CODES.map((r) => [r.code, r])
)

export function mapReasonCode(params: {
  challengeReason: string | null
  violationCode: string
  basicCategory: string | null
}): ReasonCodeResult {
  const text = (params.challengeReason ?? '').toLowerCase()

  if (text.includes('duplicate')) {
    return REASON_CODE_MAP.get('duplicate')!
  }

  if (
    text.includes('carrier') ||
    text.includes('company') ||
    text.includes('usdot') ||
    text.includes('dot number')
  ) {
    return REASON_CODE_MAP.get('company_incorrect')!
  }

  if (text.includes('driver') || text.includes('cdl') || text.includes('license')) {
    return REASON_CODE_MAP.get('driver_incorrect')!
  }

  if (
    text.includes('missing') ||
    text.includes('never occurred') ||
    text.includes('no inspection')
  ) {
    return REASON_CODE_MAP.get('inspection_missing')!
  }

  return REASON_CODE_MAP.get('violation_incorrect')!
}
