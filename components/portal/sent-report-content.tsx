import { Fragment, type ReactNode } from "react";
import {
  parseReportContent,
  parseReportInline,
  type ReportInlineSegment,
} from "@/lib/reports/report-content";
import { cn } from "@/lib/utils";

function inlineNode(segment: ReportInlineSegment, key: string): ReactNode {
  if (segment.type === "strong") {
    return (
      <strong key={key} className="font-semibold text-warm-dark">
        {segment.value}
      </strong>
    );
  }
  if (segment.type === "emphasis") {
    return <em key={key}>{segment.value}</em>;
  }
  if (segment.type === "code") {
    return (
      <code
        key={key}
        className="rounded bg-cream px-1.5 py-0.5 font-mono text-sm text-warm-mid"
      >
        {segment.value}
      </code>
    );
  }
  if (segment.type === "link") {
    const mailLink = segment.href.startsWith("mailto:");
    return (
      <a
        key={key}
        href={segment.href}
        className="font-semibold text-amber-dark underline decoration-amber underline-offset-2 hover:text-amber-hover"
        rel={mailLink ? undefined : "noreferrer"}
        target={mailLink ? undefined : "_blank"}
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

export function SentReportContent({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const blocks = parseReportContent(content);
  if (blocks.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border border-sand bg-cream px-5 py-10 text-center",
          className
        )}
      >
        <p className="text-sm font-semibold text-warm-dark">
          No report content was recorded
        </p>
        <p className="mt-1 text-xs leading-5 text-warm-mid">
          Contact your Golden Era SafeScore team for a complete copy.
        </p>
      </div>
    );
  }

  return (
    <article
      className={cn(
        "space-y-5 text-base leading-7 text-warm-mid",
        className
      )}
    >
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "heading" && block.level === 1) {
          return (
            <h1
              key={key}
              className="font-heading text-3xl font-bold leading-tight text-warm-dark"
            >
              <InlineMarkdown text={block.text} />
            </h1>
          );
        }
        if (block.type === "heading" && block.level === 2) {
          return (
            <h2
              key={key}
              className="border-b border-sand pb-2 pt-3 font-heading text-xl font-semibold text-warm-dark"
            >
              <InlineMarkdown text={block.text} />
            </h2>
          );
        }
        if (block.type === "heading") {
          return (
            <h3
              key={key}
              className="pt-2 font-heading text-base font-semibold text-warm-dark"
            >
              <InlineMarkdown text={block.text} />
            </h3>
          );
        }
        if (block.type === "metadata") {
          return (
            <p
              key={key}
              className="-mt-3 text-xs font-semibold uppercase tracking-widest text-warm-gray"
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
                  ? "ml-6 list-disc space-y-2 marker:text-amber"
                  : "ml-6 list-decimal space-y-2 marker:font-semibold marker:text-amber-dark"
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
              className="whitespace-pre-line border-l-4 border-gold bg-cream px-4 py-3 italic text-warm-mid"
            >
              <InlineMarkdown text={block.text} />
            </blockquote>
          );
        }
        if (block.type === "code") {
          return (
            <pre
              key={key}
              className="overflow-x-auto rounded-lg bg-navy p-4 font-mono text-xs leading-6 text-warm-white"
            >
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === "divider") {
          return <hr key={key} className="border-sand" />;
        }
        return (
          <div
            key={key}
            className="overflow-x-auto rounded-lg border border-sand"
          >
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-cream">
                <tr>
                  {block.headers.map((header, headerIndex) => (
                    <th
                      key={`${key}-header-${headerIndex}`}
                      className="border-b border-sand px-3 py-2 font-semibold text-warm-dark"
                    >
                      <InlineMarkdown text={header} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-sand">
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
