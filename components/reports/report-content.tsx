import { Fragment, type ReactNode } from "react";
import {
  parseReportContent,
  parseReportInline,
  type ReportInlineSegment,
} from "@/lib/reports/report-content";
import { cn } from "@/lib/utils";

function inlineNode(
  segment: ReportInlineSegment,
  key: string
): ReactNode {
  if (segment.type === "strong") {
    return <strong key={key} className="font-semibold text-[#1E1C1A]">{segment.value}</strong>;
  }
  if (segment.type === "emphasis") {
    return <em key={key}>{segment.value}</em>;
  }
  if (segment.type === "code") {
    return (
      <code
        key={key}
        className="rounded bg-[#F5F0E7] px-1.5 py-0.5 font-mono text-[0.9em] text-[#5C4B34]"
      >
        {segment.value}
      </code>
    );
  }
  if (segment.type === "link") {
    return (
      <a
        key={key}
        href={segment.href}
        className="font-medium text-[#9A5A14] underline decoration-[#C67A1E]/40 underline-offset-2 hover:text-[#6F3E0B]"
        rel={segment.href.startsWith("mailto:") ? undefined : "noreferrer"}
        target={segment.href.startsWith("mailto:") ? undefined : "_blank"}
      >
        {segment.value}
      </a>
    );
  }
  return <Fragment key={key}>{segment.value}</Fragment>;
}

function InlineMarkdown({ text }: { text: string }) {
  return (
    <>
      {parseReportInline(text).map((segment, index) =>
        inlineNode(segment, `${segment.type}-${index}`)
      )}
    </>
  );
}

export function ReportContent({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const blocks = parseReportContent(content);
  if (blocks.length === 0) {
    return (
      <p className={cn("text-sm text-gray-400", className)}>
        No content recorded for this report.
      </p>
    );
  }

  return (
    <article
      className={cn(
        "space-y-5 text-[15px] leading-7 text-[#3F3A34]",
        className
      )}
    >
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "heading" && block.level === 1) {
          return (
            <h1
              key={key}
              className="font-serif text-3xl font-bold leading-tight text-[#1E1C1A]"
            >
              <InlineMarkdown text={block.text} />
            </h1>
          );
        }
        if (block.type === "heading" && block.level === 2) {
          return (
            <h2
              key={key}
              className="border-b border-[#E7DDCE] pb-2 pt-3 font-serif text-xl font-semibold text-[#1E1C1A]"
            >
              <InlineMarkdown text={block.text} />
            </h2>
          );
        }
        if (block.type === "heading") {
          return (
            <h3
              key={key}
              className="pt-2 text-base font-semibold text-[#1E1C1A]"
            >
              <InlineMarkdown text={block.text} />
            </h3>
          );
        }
        if (block.type === "metadata") {
          return (
            <p
              key={key}
              className="-mt-3 text-xs font-medium uppercase tracking-[0.12em] text-gray-500"
            >
              <InlineMarkdown text={block.text} />
            </p>
          );
        }
        if (block.type === "paragraph") {
          return (
            <p key={key} className="whitespace-pre-line">
              <InlineMarkdown text={block.text} />
            </p>
          );
        }
        if (block.type === "unordered-list" || block.type === "ordered-list") {
          const List = block.type === "unordered-list" ? "ul" : "ol";
          return (
            <List
              key={key}
              className={
                block.type === "unordered-list"
                  ? "ml-6 list-disc space-y-2 marker:text-[#C67A1E]"
                  : "ml-6 list-decimal space-y-2 marker:font-medium marker:text-[#9A5A14]"
              }
            >
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>
                  <InlineMarkdown text={item} />
                </li>
              ))}
            </List>
          );
        }
        if (block.type === "quote") {
          return (
            <blockquote
              key={key}
              className="whitespace-pre-line border-l-4 border-[#D8B77B] bg-[#FBF7F0] px-4 py-3 italic text-[#5A5147]"
            >
              <InlineMarkdown text={block.text} />
            </blockquote>
          );
        }
        if (block.type === "code") {
          return (
            <pre
              key={key}
              className="overflow-x-auto rounded-lg bg-[#1B2D4F] p-4 font-mono text-xs leading-6 text-white"
            >
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === "divider") {
          return <hr key={key} className="border-[#E7DDCE]" />;
        }
        return (
          <div key={key} className="overflow-x-auto rounded-lg border border-[#E7DDCE]">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-[#FBF7F0]">
                <tr>
                  {block.headers.map((header, headerIndex) => (
                    <th
                      key={`${key}-header-${headerIndex}`}
                      className="border-b border-[#E7DDCE] px-3 py-2 font-semibold text-[#1E1C1A]"
                    >
                      <InlineMarkdown text={header} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEE7DD]">
                {block.rows.map((row, rowIndex) => (
                  <tr key={`${key}-row-${rowIndex}`}>
                    {row.map((cell, cellIndex) => (
                      <td
                        key={`${key}-row-${rowIndex}-cell-${cellIndex}`}
                        className="px-3 py-2 align-top"
                      >
                        <InlineMarkdown text={cell} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </article>
  );
}
