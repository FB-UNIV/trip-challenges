import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

import { Link, useLocation } from "react-router-dom";
import { HttpError } from "./api.js";

const cx = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");

// ---------- Card ----------
export function Card({
  children, hero, raise, className, style,
}: { children: ReactNode; hero?: boolean; raise?: boolean; className?: string; style?: React.CSSProperties }) {
  return <div className={cx("card", hero && "card-hero", raise && "raise", className)} style={style}>{children}</div>;
}

// ---------- Button ----------
type Variant = "primary" | "gold" | "soft" | "ghost" | "neutral" | "danger";
type Size = "block" | "lg" | "mini";
export function Button({
  variant = "primary", size, className, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  const variantClass = variant === "primary" ? "" : `btn-${variant}`;
  const sizeClass = size ? `btn-${size}` : "";
  return <button {...rest} className={cx("btn", variantClass, sizeClass, className)} />;
}

// ---------- Field ----------
export function Field({
  label, className, ...rest
}: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="field">
      <span>{label}</span>
      <input {...rest} className={className} />
    </label>
  );
}

// ---------- ErrorCard ----------
/** A failed load: the API's reason (e.g. "Too many requests — try again in 1 minute.") + retry. */
export function ErrorCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const reason = error instanceof HttpError ? error.reason : "Something went wrong.";
  return (
    <Card>
      <p className="err" style={{ marginTop: 0 }}>{reason}</p>
      <Button variant="ghost" onClick={onRetry}>Try again</Button>
    </Card>
  );
}

// ---------- Pill ----------
export type Tone = "neutral" | "accent" | "good" | "warn" | "crit" | "gold" | "lilac" | "coral" | "sky";
export function Pill({ children, tone = "neutral", dot }: { children: ReactNode; tone?: Tone; dot?: boolean }) {
  return (
    <span className={cx("pill", `pill-${tone}`)}>
      {dot && <span className="dot" />}
      {children}
    </span>
  );
}

// ---------- Phase helpers (colour encodes the trip phase) ----------
const PHASE_META: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: "lilac", label: "Draft" },
  challenge: { tone: "coral", label: "Challenge" },
  voting: { tone: "sky", label: "Voting" },
  reveal: { tone: "gold", label: "Reveal" },
  grace: { tone: "gold", label: "Grace" },
  erased: { tone: "neutral", label: "Erased" },
};
export const phaseMeta = (phase: string) => PHASE_META[phase] ?? { tone: "neutral" as Tone, label: phase };

export function PhasePill({ phase, dot }: { phase: string; dot?: boolean }) {
  const m = phaseMeta(phase);
  return <Pill tone={m.tone} dot={dot}>{m.label}</Pill>;
}

const TRAIL = [
  { key: "draft", cls: "p-draft" },
  { key: "challenge", cls: "p-challenge" },
  { key: "voting", cls: "p-voting" },
  { key: "reveal", cls: "p-reveal" },
];
const RANK: Record<string, number> = { draft: 0, challenge: 1, voting: 2, reveal: 3, grace: 4, erased: 5 };
const LABELS = {
  teacher: ["Draft", "Challenge", "Voting", "Reveal"],
  student: ["Draft", "Play", "Vote", "Reveal"],
};

export function PhaseTrail({ phase, variant = "student" }: { phase: string; variant?: "student" | "teacher" }) {
  const rank = RANK[phase] ?? 0;
  const labels = LABELS[variant];
  return (
    <div className="trail">
      {TRAIL.map((s, i) => (
        <div key={s.key} className={cx("stop", s.cls, rank > i && "done", rank === i && "here")}>
          <span className="bead" />
          <span className="lbl">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- Lightbox (shared enlarge-a-photo overlay) ----------
type LightboxContent = { src: string; title?: string; subtitle?: string; medal?: string; frame?: string };
const LightboxCtx = createContext<(c: LightboxContent | null) => void>(() => {});
export const useLightbox = () => useContext(LightboxCtx);

export function LightboxProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<LightboxContent | null>(null);

  useEffect(() => {
    if (!content) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setContent(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [content]);

  return (
    <LightboxCtx.Provider value={setContent}>
      {children}
      {content && (
        <div className="lightbox" onClick={() => setContent(null)} role="dialog" aria-modal="true" aria-label="Photo">
          <button className="lb-close" aria-label="Close" onClick={() => setContent(null)}>✕</button>
          <img
            src={content.src}
            alt={content.title ?? "photo"}
            style={content.frame ? { borderColor: content.frame } : undefined}
            onClick={(e) => e.stopPropagation()}
          />
          {(content.title || content.subtitle) && (
            <div className="lb-cap">
              {content.medal && <span className="md">{content.medal}</span>}
              {content.title && <span className="nm">{content.title}</span>}
              {content.subtitle && <span className="pt">{content.subtitle}</span>}
            </div>
          )}
          <div className="lb-hint">Click anywhere or press Esc to close</div>
        </div>
      )}
    </LightboxCtx.Provider>
  );
}

// ---------- Student guidance kit: show progress and next steps, don't explain them ----------
const clamp = (value: number, max: number) => Math.max(0, Math.min(value, max));

export function Progress({
  value, max, label, tone = "accent",
}: { value: number; max: number; label: string; tone?: "accent" | "good" | "sky" | "coral" }) {
  const now = clamp(value, max);
  return (
    <div
      className={cx("progress", `progress-${tone}`)} role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={max} aria-valuenow={now}
    >
      <i style={{ width: `${max > 0 ? (now / max) * 100 : 0}%` }} />
    </div>
  );
}

/** Compact "2/3" ring for list rows; becomes a check mark once complete. */
export function ProgressRing({ value, max, label }: { value: number; max: number; label: string }) {
  const now = clamp(value, max);
  const done = max > 0 && now >= max;
  const r = 18;
  const c = 2 * Math.PI * r;
  return (
    <div
      className={cx("ring", done && "ring-done")} role="progressbar" aria-label={label}
      aria-valuemin={0} aria-valuemax={max} aria-valuenow={now}
    >
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <circle className="ring-track" cx="22" cy="22" r={r} />
        <circle
          className="ring-fill" cx="22" cy="22" r={r}
          strokeDasharray={c} strokeDashoffset={c * (1 - (max > 0 ? now / max : 0))}
        />
      </svg>
      <span className="ring-txt" aria-hidden="true">{done ? "✓" : `${now}/${max}`}</span>
    </div>
  );
}

export type CheckState = "todo" | "doing" | "done";
const CHECK: Record<CheckState, { label: string; mark: string }> = {
  todo: { label: "To do", mark: "" },
  doing: { label: "In progress", mark: "•" },
  done: { label: "Done", mark: "✓" },
};

/** One checklist line: state bead, title, optional meta/trailing; a link when `to` is set. */
export function CheckRow({
  state, title, icon, meta, to, trailing,
}: { state: CheckState; title: string; icon?: string; meta?: ReactNode; to?: string; trailing?: ReactNode }) {
  const body = (
    <>
      <span className={cx("check", `check-${state}`)} role="img" aria-label={CHECK[state].label}>{CHECK[state].mark}</span>
      {icon && <span className="check-ic" aria-hidden="true">{icon}</span>}
      <span className="grow">
        <b>{title}</b>
        {meta && <span className="d">{meta}</span>}
      </span>
      {trailing}
      {to && <span className="chev" aria-hidden="true">›</span>}
    </>
  );
  const className = cx("check-row", `is-${state}`);
  return to ? <Link to={to} className={className}>{body}</Link> : <div className={className}>{body}</div>;
}

export type Step = { label: string; state: "done" | "current" | "upcoming"; icon?: string };

/** "What's next" path: done steps get a check, the current one glows. */
export function Stepper({ steps }: { steps: Step[] }) {
  return (
    // role="list": Safari drops list semantics from <ol> with list-style: none.
    <ol className="stepper" role="list" aria-label="Next steps">
      {steps.map((s, i) => (
        <li key={s.label} className={cx("step", `step-${s.state}`)} aria-current={s.state === "current" ? "step" : undefined}>
          <span className="step-bead" aria-hidden="true">{s.state === "done" ? "✓" : (s.icon ?? i + 1)}</span>
          <span className="step-lbl">{s.label}</span>
        </li>
      ))}
    </ol>
  );
}

/** `also`: other path prefixes that light this tab up (e.g. a scanned challenge for Challenges). */
export type Tab = { to: string; label: string; icon: string; badge?: number; disabled?: boolean; also?: string[] };

/** Bottom tab bar (thumb reach). "/" matches exactly; other tabs also match nested paths. */
export function TabBar({ tabs }: { tabs: Tab[] }) {
  const { pathname } = useLocation();
  const under = (p: string) => pathname === p || pathname.startsWith(p + "/");
  const isActive = (t: Tab) => (t.to === "/" ? pathname === "/" : [t.to, ...(t.also ?? [])].some(under));
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => {
        const inner = (
          <>
            <span className="tab-ic" aria-hidden="true">
              {t.icon}
              {!!t.badge && <span className="tab-badge">{t.badge}</span>}
            </span>
            <span className="tab-lbl">{t.label}</span>
          </>
        );
        if (t.disabled) return <span key={t.to} className="tab" aria-disabled="true">{inner}</span>;
        const active = isActive(t);
        return (
          <Link
            key={t.to} to={t.to} className={cx("tab", active && "active")}
            aria-current={active ? "page" : undefined}
            aria-label={t.badge ? `${t.label}, ${t.badge} to do` : undefined}
          >{inner}</Link>
        );
      })}
    </nav>
  );
}

/** The "all done" moment. */
export function Celebrate({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="celebrate" role="status">
      <span className="celebrate-ic" aria-hidden="true">{icon}</span>
      <h2>{title}</h2>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

/** Nothing here (yet): one icon, one line, optionally one action. */
export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-ic" aria-hidden="true">{icon}</span>
      <b>{title}</b>
      {children && <div className="empty-act">{children}</div>}
    </div>
  );
}

export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="skeleton" role="status" aria-label="Loading" aria-busy="true">
      {Array.from({ length: lines }, (_, i) => <span key={i} className="sk-line" />)}
    </div>
  );
}

// ---------- Tiny data-loading hook ----------
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const run = useCallback(() => {
    setLoading(true);
    fn().then(
      (d) => { setData(d); setError(null); setLoading(false); },
      (e) => { setError(e); setLoading(false); },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(run, [run]);
  return { data, error, loading, reload: run };
}
