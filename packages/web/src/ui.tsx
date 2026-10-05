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
