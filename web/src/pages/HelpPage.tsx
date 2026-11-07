import { Fragment, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { HELP, SECTIONS, slug, type HelpBlock, type HelpSection, type HelpTopic } from "../lib/helpContent";
import HelpVisual from "../components/help/HelpVisuals";
import { FolderIcon } from "../components/item/FolderTree";

const TOPICS = HELP.flatMap((g) => g.topics);
const GROUP_OF = new Map(HELP.flatMap((g) => g.topics.map((t) => [t.id, g.title])));

// **bold** and [links](/help/topic#section) inside a line of help text.
function inline(text: string): ReactNode {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-gray-900">
          {part.slice(2, -2)}
        </strong>
      );
    }
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      return (
        <Link key={i} to={link[2]} className="text-signal-ink underline decoration-signal/30 underline-offset-2 hover:decoration-signal-ink">
          {link[1]}
        </Link>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function Block({ block }: { block: HelpBlock }) {
  if (typeof block === "string") return <p>{inline(block)}</p>;
  if ("h" in block) {
    return (
      <h3 id={slug(block.h)} className="text-base font-semibold text-gray-900 pt-4 scroll-mt-4">
        {block.h}
      </h3>
    );
  }
  if ("list" in block) {
    return (
      <ul className="list-disc pl-5 flex flex-col gap-1.5 marker:text-gray-400">
        {block.list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>
    );
  }
  if ("steps" in block) {
    return (
      <ol className="flex flex-col gap-2">
        {block.steps.map((step, i) => (
          <li key={i} className="flex gap-3">
            <span className="w-6 h-6 shrink-0 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold flex items-center justify-center tabular-nums mt-0.5">
              {i + 1}
            </span>
            <span className="min-w-0">{inline(step)}</span>
          </li>
        ))}
      </ol>
    );
  }
  // Advice, set apart from how R2 works: everything else on the page.
  if ("tip" in block || "practice" in block) {
    const inner = "tip" in block ? [block.tip] : block.practice;
    return (
      <div className="border-l-[3px] border-lock bg-emerald-50/60 rounded-r-md px-4 py-3 flex flex-col gap-3">
        <div className="flex items-center gap-1.5 eyebrow text-emerald-800">
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          Best practice
        </div>
        {inner.map((b, i) => (
          <Block key={i} block={b} />
        ))}
      </div>
    );
  }
  if ("table" in block) {
    return (
      <div className="border border-gray-200 rounded-md overflow-hidden">
        <table className="w-full text-sm border-collapse table-fixed">
          <thead>
            <tr className="bg-gray-50">
              {block.table.head.map((h) => (
                <th key={h} className="text-left font-medium text-gray-600 px-3 py-2 border-b border-gray-200 break-words">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.table.rows.map((row, i) => (
              <tr key={i} className="border-t border-gray-100 first:border-t-0 align-top">
                {row.map((cell, j) => (
                  <td key={j} className={`px-3 py-2 break-words ${j === 0 ? "text-gray-900 font-medium" : "text-gray-700"}`}>
                    {inline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return <HelpVisual id={block.ui} caption={block.caption} />;
}

// Previous / next topic, as quiet buttons like the app's other "go there" links.
function StepLink({ topic, label }: { topic: HelpTopic; label: "Previous" | "Next" }) {
  const next = label === "Next";
  return (
    <Link
      to={`/help/${topic.id}`}
      className={`group flex items-center gap-2 min-w-0 rounded-md border border-gray-200 px-3 py-2.5 hover:bg-gray-50 hover:border-gray-300 transition-colors ${next ? "flex-row-reverse text-right" : ""}`}
    >
      <svg viewBox="0 0 20 20" className={`w-4 h-4 shrink-0 text-gray-400 group-hover:text-gray-700 ${next ? "" : "rotate-180"}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M8 5l5 5-5 5" />
      </svg>
      <span className="flex flex-col min-w-0">
        <span className="text-xs text-gray-500">{label}</span>
        <span className="text-sm font-medium text-gray-900 truncate">{topic.title}</span>
      </span>
    </Link>
  );
}

function Article({ topic }: { topic: HelpTopic }) {
  const index = TOPICS.findIndex((t) => t.id === topic.id);
  const prev = TOPICS[index - 1];
  const next = TOPICS[index + 1];
  return (
    <article className="card p-4 md:p-7 min-w-0">
      <div className="eyebrow text-gray-500 mb-1">{GROUP_OF.get(topic.id)}</div>
      <h2 className="text-2xl font-semibold text-gray-900 mb-4">{topic.title}</h2>
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-gray-700 max-w-3xl">
        {topic.blocks.map((b, i) => (
          <Block key={i} block={b} />
        ))}
      </div>
      <nav className="grid grid-cols-2 gap-3 mt-10">
        {prev ? <StepLink topic={prev} label="Previous" /> : <span />}
        {next && <StepLink topic={next} label="Next" />}
      </nav>
    </article>
  );
}

// A few words around the first match, so you can tell results apart.
function snippet(text: string, words: string[]): string {
  const lower = text.toLowerCase();
  const at = Math.max(0, ...words.map((w) => lower.indexOf(w)).filter((i) => i >= 0).slice(0, 1));
  const start = Math.max(0, at - 60);
  const end = Math.min(text.length, at + 120);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

function Results({ query, words, onPick }: { query: string; words: string[]; onPick: (topicId: string) => void }) {
  const results: HelpSection[] = SECTIONS.filter((s) => {
    const text = s.text.toLowerCase();
    return words.every((w) => text.includes(w));
  })
    // Title and heading matches first.
    .map((s) => ({ s, score: words.filter((w) => `${s.topic.title} ${s.heading ?? ""}`.toLowerCase().includes(w)).length }))
    .sort((a, b) => b.score - a.score)
    .map((r) => r.s)
    .slice(0, 40);
  return (
    <div className="card min-w-0">
      {results.length === 0 ? (
        <p className="p-4 text-sm text-gray-500">Nothing matches "{query.trim()}".</p>
      ) : (
        results.map((s) => (
          <Link
            key={`${s.topic.id}#${s.anchor}`}
            to={`/help/${s.topic.id}${s.anchor ? `#${s.anchor}` : ""}`}
            onClick={() => onPick(s.topic.id)}
            className="block px-4 py-3 border-t border-gray-100 first:border-t-0 hover:bg-gray-50"
          >
            <div className="text-sm font-medium text-gray-900">
              {s.topic.title}
              {s.heading && <span className="text-gray-500 font-normal"> › {s.heading}</span>}
            </div>
            <div className="text-sm text-gray-500 mt-0.5 line-clamp-2">{snippet(s.text, words)}</div>
          </Link>
        ))
      )}
    </div>
  );
}

function TopicIcon({ current }: { current: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinejoin="round" className={`w-4 h-4 shrink-0 ${current ? "text-signal" : "text-gray-400"}`} aria-hidden>
      <path d="M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
      <path d="M14 3v4h4M8.5 12h7M8.5 16h5" strokeLinecap="round" />
    </svg>
  );
}

function Chevron({ open, hidden = false, onClick }: { open: boolean; hidden?: boolean; onClick?: () => void }) {
  return (
    <span
      onClick={(e) => {
        if (!onClick) return;
        e.preventDefault();
        e.stopPropagation();
        onClick();
      }}
      className={`w-5 h-5 shrink-0 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 ${hidden ? "invisible" : ""}`}
    >
      <svg viewBox="0 0 20 20" className={`w-3 h-3 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 5l5 5-5 5" />
      </svg>
    </span>
  );
}

const rowClass = (current: boolean) =>
  `flex items-center gap-1 h-8 pr-1 rounded-md text-sm ${current ? "bg-gray-900/[0.06] text-gray-900 font-medium" : "text-gray-700 hover:bg-gray-100"}`;

// The topics as a tree, looking like the inventory's folders: groups (the
// app's own sidebar sections) hold topics, and topics open to their
// sections. The current topic and its group start open; searching opens
// every group. A group with one topic is just that topic. active: the
// section scrolled to ("" for the top); onSection scrolls to one.
function TopicTree({
  groups,
  current,
  active,
  searching,
  open,
  toggle,
  onPick,
  onSection,
}: {
  groups: typeof HELP;
  current: string;
  active: string;
  searching: boolean;
  open: Set<string>;
  toggle: (key: string) => void;
  onPick: () => void;
  onSection: (anchor: string) => void;
}) {
  const groupOf = GROUP_OF.get(current) ?? "";

  function topicRow(t: HelpTopic, depth: number) {
    const headings = t.blocks.filter((b): b is { h: string } => typeof b === "object" && "h" in b);
    const isCurrent = t.id === current;
    const isOpen = open.has(t.id) && headings.length > 0;
    return (
      <div key={t.id}>
        <Link
          to={`/help/${t.id}`}
          onClick={() => {
            onPick();
            if (isCurrent) onSection("");
          }}
          className={rowClass(isCurrent && !active)}
          style={{ paddingLeft: 4 + depth * 14 }}
        >
          <Chevron open={isOpen} hidden={headings.length === 0} onClick={() => toggle(t.id)} />
          <TopicIcon current={isCurrent} />
          <span className="truncate ml-0.5">{t.title}</span>
        </Link>
        {isOpen &&
          headings.map((h) => {
            const anchor = slug(h.h);
            return (
              <Link
                key={anchor}
                to={`/help/${t.id}#${anchor}`}
                onClick={() => {
                  onPick();
                  if (isCurrent) onSection(anchor);
                }}
                className={rowClass(isCurrent && active === anchor)}
                style={{ paddingLeft: 4 + (depth + 1) * 14 + 20 + 4 }}
              >
                <span className="truncate">{h.h}</span>
              </Link>
            );
          })}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {groups.map((g) => {
        if (g.topics.length === 1 && HELP.find((x) => x.title === g.title)?.topics.length === 1) return topicRow(g.topics[0], 0);
        const isOpen = searching || open.has(g.title);
        return (
          <div key={g.title}>
            <button type="button" onClick={() => toggle(g.title)} className={`w-full text-left ${rowClass(false)} ${g.title === groupOf ? "font-medium text-gray-900" : ""}`} aria-expanded={isOpen} style={{ paddingLeft: 4 }}>
              <Chevron open={isOpen} />
              <FolderIcon open={isOpen} className="w-4 h-4 text-gray-400" />
              <span className="flex-1 min-w-0 truncate ml-0.5">{g.title}</span>
              <span className="font-mono text-[11px] text-gray-400 pr-1">{g.topics.length}</span>
            </button>
            {isOpen && g.topics.map((t) => topicRow(t, 1))}
          </div>
        );
      })}
    </div>
  );
}

export default function HelpPage() {
  const { topic: topicId } = useParams();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const topic = TOPICS.find((t) => t.id === topicId) ?? TOPICS[0];
  const top = useRef<HTMLDivElement>(null);
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const searching = words.length > 0;
  // The topics list narrows to the topics that match the search.
  const groups = HELP.map((g) => ({
    ...g,
    topics: g.topics.filter((t) => SECTIONS.some((s) => s.topic.id === t.id && words.every((w) => s.text.toLowerCase().includes(w)))),
  })).filter((g) => g.topics.length > 0);

  const [active, setActive] = useState("");

  // Open folders in the topics list (groups by title, topics by id). The
  // current topic and its group always open; picking a search result
  // closes everything else.
  const where = (id: string) => [GROUP_OF.get(id) ?? "", id];
  const [open, setOpen] = useState<Set<string>>(() => new Set(where(topic.id)));
  useEffect(() => {
    setOpen((prev) => new Set([...prev, ...where(topic.id)]));
  }, [topic.id]);
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  function pickResult(topicId: string) {
    setQuery("");
    setOpen(new Set(where(topicId)));
  }
  const shown = useRef("");

  // Scrolls to a section of the open topic ("" for its top), smoothly, so
  // it's clear the page moved.
  function scrollTo(anchor: string, smooth: boolean) {
    const target = anchor ? document.getElementById(anchor) : null;
    (target ?? top.current)?.scrollIntoView({ block: "start", behavior: smooth ? "smooth" : "auto" });
  }

  // A new topic opens at its top, or at the section the link points to;
  // a link to another part of the same topic scrolls there.
  useEffect(() => {
    if (searching) return;
    const anchor = hash ? decodeURIComponent(hash.slice(1)) : "";
    scrollTo(anchor, shown.current === topic.id);
    shown.current = topic.id;
  }, [topic.id, hash, searching]);

  // The section being read: the last heading scrolled past the top.
  useEffect(() => {
    const scroller = top.current?.closest("main");
    if (!scroller || searching) return;
    const update = () => {
      const edge = scroller.getBoundingClientRect().top + 96;
      let current = "";
      for (const h of topic.blocks) {
        if (typeof h !== "object" || !("h" in h)) continue;
        const el = document.getElementById(slug(h.h));
        if (el && el.getBoundingClientRect().top <= edge) current = slug(h.h);
      }
      // At the very bottom, the last section counts even if it's short.
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
        const last = [...topic.blocks].reverse().find((b) => typeof b === "object" && "h" in b) as { h: string } | undefined;
        if (last) current = slug(last.h);
      }
      setActive(current);
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    return () => scroller.removeEventListener("scroll", update);
  }, [topic, searching]);

  return (
    <div ref={top} className="max-w-6xl mx-auto w-full flex flex-col gap-4 scroll-mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-gray-900">Help</h1>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help, e.g. naming, test and tag, quote"
          aria-label="Search help"
          className="input py-2 w-full sm:w-96"
        />
      </div>

      {/* Phones: pick a topic from a list. */}
      {words.length === 0 && (
        <select value={topic.id} onChange={(e) => navigate(`/help/${e.target.value}`)} className="input py-2 lg:hidden" aria-label="Topic">
          {HELP.map((g) => (
            <optgroup key={g.title} label={g.title}>
              {g.topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[16rem_minmax(0,1fr)] gap-4 items-start">
        <aside className="hidden lg:flex card p-2 flex-col sticky top-0 max-h-[calc(100vh-7rem)] min-h-0">
          <div className="overflow-y-auto min-h-0">
            <TopicTree groups={groups} current={topic.id} active={active} searching={searching} open={open} toggle={toggle} onPick={() => setQuery("")} onSection={(anchor) => scrollTo(anchor, true)} />
          </div>
        </aside>
        {words.length > 0 ? <Results query={query} words={words} onPick={pickResult} /> : <Article topic={topic} />}
      </div>
    </div>
  );
}
