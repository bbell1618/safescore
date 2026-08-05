"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Check, FileSearch, Loader2 } from "lucide-react";
import {
  CPDP_ELIGIBILITY_QUESTIONS,
  type CpdpQuestionAnswer,
  type ParAiAssessment,
} from "@/lib/cpdp/par-assessment-types";

type Props = {
  caseId: string;
  assessment: ParAiAssessment;
  approved: boolean;
  onApproved: (eligibleTypes: string[], narrative: string | null) => void;
};

const ANSWERS: CpdpQuestionAnswer[] = ["YES", "NO", "UNCLEAR"];

function answerClasses(answer: string) {
  if (answer === "YES" || answer === "MATCH") return "border-green-200 bg-green-50 text-green-800";
  if (answer === "NO" || answer === "MISMATCH") return "border-red-200 bg-red-50 text-red-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

export function ParAssessmentReview({ caseId, assessment, approved, onApproved }: Props) {
  const [answers, setAnswers] = useState<Record<string, CpdpQuestionAnswer>>(
    Object.fromEntries(assessment.questions.map((question) => [question.id, question.answer]))
  );
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});
  const [supportingExcerpts, setSupportingExcerpts] = useState<Record<string, string>>({});
  const [identityOverrideReason, setIdentityOverrideReason] = useState("");
  const [narrative, setNarrative] = useState(assessment.draftedNarrative ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(approved);
  const answerCount = useMemo(
    () => Object.values(answers).filter((answer) => answer === "YES").length,
    [answers]
  );

  async function approve() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/cases/cpdp/${caseId}/par-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identityConfirmed: true,
          identityOverrideReason: identityOverrideReason.trim() || null,
          questions: CPDP_ELIGIBILITY_QUESTIONS.map((question) => ({
            id: question.id,
            answer: answers[question.id],
            overrideReason: overrideReasons[question.id]?.trim() || null,
            supportingExcerpt: supportingExcerpts[question.id]?.trim() || null,
          })),
          finalNarrative: narrative.trim() || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "PAR review approval failed");
      setSaved(true);
      onApproved(payload.eligibleTypes ?? [], narrative.trim() || null);
    } catch (approvalError) {
      setError(approvalError instanceof Error ? approvalError.message : "PAR review approval failed");
    } finally {
      setSaving(false);
    }
  }

  const identityChecks = [
    ["Report number", assessment.identity.reportNumber],
    ["Crash date", assessment.identity.crashDate],
    ["Location", assessment.identity.location],
    ["Carrier / USDOT", assessment.identity.carrier],
  ] as const;

  return (
    <div className="space-y-5 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <FileSearch className="h-4 w-4 text-blue-700" />
            <h3 className="text-sm font-semibold text-[#1E1C1A]">AI PAR determination review</h3>
          </div>
          <p className="mt-1 text-[11px] text-gray-600">
            {assessment.documentMode.replaceAll("_", " ")} · {assessment.model} · confidence {assessment.confidence}%
          </p>
        </div>
        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold ${answerClasses(assessment.verdict === "ELIGIBLE" ? "YES" : assessment.verdict === "NOT_ELIGIBLE" ? "NO" : "UNCLEAR")}`}>
          {assessment.verdict.replaceAll("_", " ")}
        </span>
      </div>

      <div>
        <h4 className="text-xs font-semibold text-[#1E1C1A]">PAR identity match</h4>
        <p className="mt-1 text-[11px] text-gray-600">{assessment.identity.reasoning}</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {identityChecks.map(([label, check]) => (
            <div key={label} className="rounded-lg border border-[#E6DED2] bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-[#1E1C1A]">{label}</span>
                <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${answerClasses(check.answer)}`}>
                  {check.answer.replaceAll("_", " ")}
                </span>
              </div>
              <dl className="mt-2 space-y-1 text-[10px] text-gray-600">
                <div><dt className="inline font-semibold">PAR: </dt><dd className="inline">{check.observed ?? "Not stated"}</dd></div>
                <div><dt className="inline font-semibold">Record: </dt><dd className="inline">{check.expected ?? "Not on file"}</dd></div>
              </dl>
              {check.excerpt && <blockquote className="mt-2 border-l-2 border-blue-200 pl-2 text-[10px] italic text-gray-600">“{check.excerpt}”</blockquote>}
              <p className="mt-2 text-[10px] text-gray-500">{check.reasoning}</p>
            </div>
          ))}
        </div>
        {assessment.identity.overall !== "MATCH" && !saved && (
          <label className="mt-3 block text-[11px] font-medium text-amber-800">
            Identity override reason
            <textarea
              value={identityOverrideReason}
              onChange={(event) => setIdentityOverrideReason(event.target.value)}
              className="mt-1 min-h-16 w-full rounded-lg border border-amber-300 bg-white p-2 text-xs text-[#1E1C1A]"
              placeholder="State the exact corroborating fact the AI missed."
            />
          </label>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold text-[#1E1C1A]">All 21 FMCSA eligibility questions</h4>
          <span className="text-[10px] text-gray-500">{answerCount} supported</span>
        </div>
        <div className="mt-3 space-y-2">
          {assessment.questions.map((question, index) => {
            const reviewedAnswer = answers[question.id] ?? question.answer;
            const overridden = reviewedAnswer !== question.answer;
            return (
              <div key={question.id} className="rounded-lg border border-[#E6DED2] bg-white p-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-semibold leading-relaxed text-[#1E1C1A]">{index + 1}. {question.label}</p>
                    {question.excerpt ? (
                      <blockquote className="mt-1.5 border-l-2 border-[#C67A1E]/40 pl-2 text-[10px] italic text-gray-600">“{question.excerpt}”</blockquote>
                    ) : (
                      <p className="mt-1.5 text-[10px] italic text-gray-400">No supporting PAR excerpt.</p>
                    )}
                    <p className="mt-1.5 text-[10px] text-gray-500">
                      {question.overrideReason
                        ? `Operator override: ${question.overrideReason}`
                        : question.reasoning}
                    </p>
                  </div>
                  <select
                    aria-label={`Review answer for ${question.label}`}
                    value={reviewedAnswer}
                    disabled={saved}
                    onChange={(event) => setAnswers((current) => ({
                      ...current,
                      [question.id]: event.target.value as CpdpQuestionAnswer,
                    }))}
                    className={`min-h-10 rounded-lg border px-2 text-[10px] font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E] ${answerClasses(reviewedAnswer)}`}
                  >
                    {ANSWERS.map((answer) => <option key={answer}>{answer}</option>)}
                  </select>
                </div>
                {overridden && !saved && (
                  <div className="mt-2 space-y-2">
                    <input
                      value={overrideReasons[question.id] ?? ""}
                      onChange={(event) => setOverrideReasons((current) => ({ ...current, [question.id]: event.target.value }))}
                      className="min-h-10 w-full rounded-lg border border-amber-300 px-2 text-xs"
                      placeholder="Required: why the operator changed the AI answer"
                    />
                    {reviewedAnswer === "YES" && (
                      <textarea
                        value={supportingExcerpts[question.id] ?? ""}
                        onChange={(event) => setSupportingExcerpts((current) => ({
                          ...current,
                          [question.id]: event.target.value,
                        }))}
                        className="min-h-16 w-full rounded-lg border border-amber-300 px-2 py-2 text-xs"
                        placeholder="Required: paste the exact supporting PAR excerpt"
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <label className="block text-xs font-semibold text-[#1E1C1A]">
        Grounded Request for Determination narrative
        <textarea
          value={narrative}
          disabled={saved}
          onChange={(event) => setNarrative(event.target.value)}
          className="mt-2 min-h-52 w-full rounded-lg border border-[#E6DED2] bg-white p-3 font-mono text-xs font-normal leading-relaxed text-[#1E1C1A] disabled:bg-gray-50"
          placeholder={answerCount > 0 ? "A PAR-grounded narrative is required." : "No filing narrative is created when no eligible type is supported."}
        />
      </label>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <div className="flex justify-end">
        {saved ? (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700">
            <Check className="h-3.5 w-3.5" /> Reviewed and approved
          </span>
        ) : (
          <button
            type="button"
            onClick={approve}
            disabled={saving}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[#C67A1E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#B86E18] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C67A1E] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {saving ? "Approving…" : "Approve PAR determination"}
          </button>
        )}
      </div>
    </div>
  );
}
