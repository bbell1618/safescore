export const CPDP_ELIGIBILITY_QUESTIONS = [
  {
    id: "struck_in_rear",
    label: "CMV was struck in the rear by a motorist",
    question: "Does the PAR show the CMV was struck in the rear by a motorist?",
  },
  {
    id: "struck_side_at_rear",
    label: "CMV was struck on the side at the rear by a motorist",
    question: "Does the PAR show the CMV was struck on the side at the rear by a motorist?",
  },
  {
    id: "struck_side_same_direction",
    label: "CMV was struck on the side by a motorist operating in the same direction as CMV",
    question: "Does the PAR show the CMV was struck on the side by a motorist operating in the same direction?",
  },
  {
    id: "wrong_direction",
    label: "CMV was struck because another motorist was driving in the wrong direction",
    question: "Does the PAR show the CMV was struck because another motorist was driving in the wrong direction?",
  },
  {
    id: "uturn_or_illegal_turn",
    label: "CMV was struck because another motorist was making a U-turn or illegal turn",
    question: "Does the PAR show the CMV was struck because another motorist was making a U-turn or illegal turn?",
  },
  {
    id: "legally_stopped_or_parked",
    label: "CMV was struck while legally stopped at a traffic control device or parked",
    question: "Does the PAR show the CMV was struck while legally stopped at a traffic control device or parked, including unattended?",
  },
  {
    id: "did_not_stop_or_slow",
    label: "CMV was struck because another motorist did not stop or slow in traffic",
    question: "Does the PAR show the CMV was struck because another motorist did not stop or slow in traffic?",
  },
  {
    id: "traffic_control_failure",
    label: "CMV was struck because another motorist failed to stop at a traffic control device",
    question: "Does the PAR show the CMV was struck because another motorist failed to stop at a traffic control device?",
  },
  {
    id: "impaired_driver",
    label: "CMV was struck because another individual was under the influence",
    question: "Does the PAR show the CMV was struck because another individual was under the influence under the jurisdiction's legal standard?",
  },
  {
    id: "medical_issue",
    label: "CMV was struck because another motorist experienced a medical issue",
    question: "Does the PAR show the CMV was struck because another motorist experienced a medical issue that contributed to the crash?",
  },
  {
    id: "fell_asleep",
    label: "CMV was struck because another motorist fell asleep",
    question: "Does the PAR show the CMV was struck because another motorist fell asleep?",
  },
  {
    id: "distracted_driver",
    label: "CMV was struck because another motorist was distracted",
    question: "Does the PAR show the CMV was struck because another motorist was distracted, such as by a cellphone, GPS, passengers, or another distraction?",
  },
  {
    id: "cargo_equipment_or_debris",
    label: "CMV was struck by cargo, equipment, or debris",
    question: "Does the PAR show the CMV was struck by cargo or equipment from another vehicle, or by debris?",
  },
  {
    id: "infrastructure_failure",
    label: "CMV crash was a result of an infrastructure failure",
    question: "Does the PAR show the CMV crash resulted from an infrastructure failure?",
  },
  {
    id: "animal_strike",
    label: "CMV struck an animal",
    question: "Does the PAR show the CMV struck an animal?",
  },
  {
    id: "suicide",
    label: "CMV crash involved a suicide death or suicide attempt",
    question: "Does the PAR show the CMV crash involved a suicide death or suicide attempt?",
  },
  {
    id: "entered_from_private_drive",
    label: "CMV was struck because another motorist was entering from a private driveway or parking lot",
    question: "Does the PAR show the CMV was struck because another motorist entered the roadway from a private driveway or parking lot?",
  },
  {
    id: "other_motorist_lost_control",
    label: "CMV was struck because another motorist lost control of the vehicle",
    question: "Does the PAR show the CMV was struck because another motorist lost control of the vehicle?",
  },
  {
    id: "non_motorist",
    label: "CMV was involved in a crash with a non-motorist",
    question: "Does the PAR show the CMV was involved in a crash with a non-motorist?",
  },
  {
    id: "rare_or_unusual",
    label: "CMV was involved in a rare or unusual crash type",
    question: "Does the PAR show a crash type that seldom occurs and does not meet another eligible crash type?",
  },
  {
    id: "video_demonstrates_sequence",
    label: "Video demonstrates the sequence of events for another CMV crash type",
    question: "For a crash not covered by another type, does submitted video demonstrate the sequence of events and that the crash was not preventable by the CMV driver?",
  },
] as const;

export type CpdpQuestionId = (typeof CPDP_ELIGIBILITY_QUESTIONS)[number]["id"];
export type CpdpQuestionAnswer = "YES" | "NO" | "UNCLEAR";
export type ParIdentityAnswer = "MATCH" | "MISMATCH" | "NOT_COMPARABLE" | "UNCLEAR";

export type ParEvidenceCheck<TAnswer extends string> = {
  answer: TAnswer;
  observed: string | null;
  expected: string | null;
  excerpt: string | null;
  reasoning: string;
};

export type ParQuestionAssessment = {
  id: CpdpQuestionId;
  label: string;
  answer: CpdpQuestionAnswer;
  excerpt: string | null;
  reasoning: string;
  overrideReason?: string | null;
};

export type ParAiAssessment = {
  schemaVersion: 1;
  documentMode: "pdf_text" | "pdf_vision" | "image_vision" | "plain_text";
  identity: {
    reportNumber: ParEvidenceCheck<ParIdentityAnswer>;
    crashDate: ParEvidenceCheck<ParIdentityAnswer>;
    location: ParEvidenceCheck<ParIdentityAnswer>;
    carrier: ParEvidenceCheck<ParIdentityAnswer>;
    overall: "MATCH" | "MISMATCH" | "UNCLEAR";
    reasoning: string;
  };
  questions: ParQuestionAssessment[];
  verdict: "ELIGIBLE" | "INDETERMINATE" | "NOT_ELIGIBLE";
  confidence: number;
  overallReasoning: string;
  draftedNarrative: string | null;
  model: string;
  assessedAt: string;
};

export function eligibleTypesFromQuestions(
  questions: Pick<ParQuestionAssessment, "id" | "answer">[]
): string[] {
  const answerById = new Map(questions.map((question) => [question.id, question.answer]));
  return CPDP_ELIGIBILITY_QUESTIONS.filter(
    (question) => answerById.get(question.id) === "YES"
  ).map((question) => question.label);
}
