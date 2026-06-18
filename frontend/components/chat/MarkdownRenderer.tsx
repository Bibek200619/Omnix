"use client";

import { useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

type MarkdownRendererProps = {
  content: string;
  compact?: boolean;
};

type StreamingTextRendererProps = MarkdownRendererProps & {
  showCursor?: boolean;
};

function CodeBlock({ code, language }: { code: string; language?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    if (!navigator.clipboard) return;

    await navigator.clipboard.writeText(code);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  }

  return (
    <div className="my-3 overflow-hidden rounded-lg border border-[var(--omnix-border)] bg-[#05070b] shadow-[0_16px_50px_rgba(0,0,0,0.28)]">
      <div className="flex h-10 items-center justify-between border-b border-[var(--omnix-border)] bg-[var(--omnix-surface)] px-3">
        <span className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">
          {language || "code"}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex h-11 w-11 items-center justify-center rounded-md text-slate-400 transition hover:bg-[var(--omnix-surface)] hover:text-white"
          aria-label="Copy code"
          title="Copy code"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
      </div>
      <SyntaxHighlighter
        language={language || "text"}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          background: "transparent",
          padding: "1rem",
          fontSize: "13px",
          lineHeight: "1.65",
        }}
        codeTagProps={{
          style: {
            fontFamily:
              "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          },
        }}
        wrapLongLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

export function MarkdownRenderer({ content, compact = false }: MarkdownRendererProps) {
  const components: Components = {
    p({ children }) {
      return (
        <p className={cn("leading-7 text-[var(--omnix-text-2)]", compact ? "text-sm" : "text-[15px]")}>
          {children}
        </p>
      );
    },
    a({ children, href }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-cyan-200 underline decoration-cyan-200/30 underline-offset-4 hover:text-cyan-100"
        >
          {children}
        </a>
      );
    },
    ul({ children }) {
      return <ul className="my-3 list-disc space-y-1.5 pl-5 text-[var(--omnix-text-2)]">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="my-3 list-decimal space-y-1.5 pl-5 text-[var(--omnix-text-2)]">{children}</ol>;
    },
    li({ children }) {
      return <li className="leading-6">{children}</li>;
    },
    blockquote({ children }) {
      return (
        <blockquote className="my-3 border-l-2 border-cyan-300/50 bg-cyan-300/5 py-1 pl-4 text-slate-300">
          {children}
        </blockquote>
      );
    },
    pre({ children }) {
      return <>{children}</>;
    },
    h1({ children }) {
      return <h1 className="omnix-display mb-3 text-xl font-semibold text-white">{children}</h1>;
    },
    h2({ children }) {
      return <h2 className="omnix-display mb-3 text-lg font-semibold text-white">{children}</h2>;
    },
    h3({ children }) {
      return <h3 className="omnix-display mb-2 text-base font-semibold text-white">{children}</h3>;
    },
    table({ children }) {
      return (
        <div className="omnix-scrollbar my-3 overflow-x-auto rounded-lg border border-[var(--omnix-border)] bg-black/20">
          <table className="min-w-full divide-y divide-[var(--omnix-border)] text-sm">
            {children}
          </table>
        </div>
      );
    },
    th({ children }) {
      return (
        <th className="bg-[var(--omnix-surface)] px-3 py-2 text-left font-medium text-white">
          {children}
        </th>
      );
    },
    td({ children }) {
      return <td className="border-t border-[var(--omnix-border)] px-3 py-2 text-[var(--omnix-text-2)]">{children}</td>;
    },
    code({ className, children }) {
      const value = String(children).replace(/\n$/, "");
      const match = /language-([\w-]+)/.exec(className || "");

      if (!match && !value.includes("\n")) {
        return (
          <code className="rounded-md border border-cyan-300/15 bg-cyan-300/10 px-1.5 py-0.5 text-[0.9em] text-cyan-100">
            {children}
          </code>
        );
      }

      return <CodeBlock code={value} language={match?.[1]} />;
    },
  };

  return (
    <div className="space-y-3 break-words text-slate-100">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function StreamingTextRenderer({
  content,
  compact = false,
  showCursor = true,
}: StreamingTextRendererProps) {
  return (
    <div className="break-words text-slate-100">
      <p
        className={cn(
          "whitespace-pre-wrap leading-7 text-[var(--omnix-text-2)]",
          compact ? "text-sm" : "text-[15px]",
        )}
      >
        {content}
        {showCursor ? (
          <span
            aria-hidden="true"
            className="ml-0.5 inline-block h-4 w-1 translate-y-0.5 animate-pulse rounded-full bg-cyan-200/80 align-middle"
          />
        ) : null}
      </p>
    </div>
  );
}
