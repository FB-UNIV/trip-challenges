// Full-screen awards ceremony for the reveal phase. Steps through each challenge's
// podium (revealed bottom-up for suspense) and finishes on the Grand Champion.
// Advance with click / Space / →, go back with ←. Reads the non-PII results that
// survive Erasure, so it keeps working as a keepsake afterwards.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { api, type ResultRow } from "../api.js";
import { useAsync } from "../ui.js";

type Scene =
  | { kind: "intro" }
  | { kind: "challenge"; title: string; podium: ResultRow[] }
  | { kind: "champion"; teams: ResultRow[] }
  | { kind: "empty" };

const MEDAL = ["🥇", "🥈", "🥉"];

function buildScenes(results: ResultRow[]): Scene[] {
  const champs = results.filter((r) => r.is_grand_champion);
  const byChallenge = new Map<string, ResultRow[]>();
  for (const r of results) {
    if (r.is_grand_champion) continue;
    (byChallenge.get(r.challenge_title) ?? byChallenge.set(r.challenge_title, []).get(r.challenge_title)!).push(r);
  }
  const scenes: Scene[] = [{ kind: "intro" }];
  for (const [title, rows] of byChallenge) {
    scenes.push({ kind: "challenge", title, podium: [...rows].sort((a, b) => a.placement - b.placement).slice(0, 3) });
  }
  if (champs.length) scenes.push({ kind: "champion", teams: champs });
  return scenes.length === 1 ? [{ kind: "empty" }] : scenes;
}

export function Ceremony() {
  const { id } = useParams();
  const res = useAsync(() => api.results(id!), [id]);
  const scenes = useMemo(() => buildScenes(res.data?.results ?? []), [res.data]);
  const [i, setI] = useState(0);

  const next = useCallback(() => setI((n) => Math.min(n + 1, scenes.length - 1)), [scenes.length]);
  const prev = useCallback(() => setI((n) => Math.max(n - 1, 0)), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " || e.key === "ArrowRight" || e.key === "Enter") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); prev(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  const scene = scenes[Math.min(i, scenes.length - 1)];

  return (
    <div onClick={next} style={S.stage}>
      <style>{KEYFRAMES}</style>
      {res.loading ? (
        <p style={{ color: "#b7aac9" }}>Loading…</p>
      ) : scene?.kind === "empty" ? (
        <div style={S.center}><h1 style={S.h1}>No results yet</h1><p style={S.sub}>Results appear once voting closes.</p></div>
      ) : (
        <SceneView key={i} scene={scene!} />
      )}

      <div style={S.hud} onClick={(e) => e.stopPropagation()}>
        <button style={S.ghost} onClick={prev} disabled={i === 0}>← Back</button>
        <div style={S.dots}>
          {scenes.map((_, n) => (
            <span key={n} style={{ ...S.dot, ...(n === i ? S.dotOn : null) }} />
          ))}
        </div>
        <button style={S.ghost} onClick={next} disabled={i >= scenes.length - 1}>Reveal →</button>
      </div>
      <div style={S.hint}>Click, Space or → to reveal · ← to go back</div>
    </div>
  );
}

function SceneView({ scene }: { scene: Scene }) {
  if (scene.kind === "intro") {
    return (
      <div style={S.center}>
        <div style={{ ...S.pop, fontSize: 96 }}>🏆</div>
        <h1 style={{ ...S.h1, animation: "rise .6s .1s both" }}>And the winners are…</h1>
        <p style={{ ...S.sub, animation: "rise .6s .35s both" }}>Tap to begin the ceremony</p>
      </div>
    );
  }
  if (scene.kind === "challenge") {
    // Render bottom-up (3rd first, 1st last) so the winner lands last and biggest.
    const rows = [...scene.podium].reverse();
    return (
      <div style={S.center}>
        <h2 style={{ ...S.chTitle, animation: "rise .5s both" }}>{scene.title}</h2>
        <div style={S.podium}>
          {rows.map((r) => {
            const place = r.placement; // 1..3
            const delay = (4 - place) * 0.5; // 3rd first, 1st last
            return (
              <div key={r.placement} style={{ ...S.row, ...placeStyle(place), animation: `rise .55s ${delay}s both` }}>
                <span style={S.medal}>{MEDAL[place - 1] ?? `#${place}`}</span>
                <span style={S.team}>{r.team_name_vetted}</span>
                <span style={S.pts}>{r.points} pts</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  if (scene.kind === "champion") {
    return (
      <div style={S.center}>
        <div style={{ fontSize: 120, animation: "pop .7s both" }}>👑</div>
        <p style={{ ...S.sub, animation: "rise .5s .2s both" }}>Grand Champion</p>
        {scene.teams.map((t, n) => (
          <h1 key={n} style={{ ...S.champ, animation: `pop .7s ${0.4 + n * 0.2}s both` }}>
            {t.team_name_vetted}
            <span style={S.champPts}> · {t.points} pts</span>
          </h1>
        ))}
        {scene.teams.length > 1 && <p style={S.sub}>(a tie — teacher decides)</p>}
      </div>
    );
  }
  return null;
}

function placeStyle(place: number): React.CSSProperties {
  if (place === 1) return { fontSize: 40, color: "#f6d079", fontWeight: 800 };
  if (place === 2) return { fontSize: 30, color: "#e5e7eb", fontWeight: 700 };
  if (place === 3) return { fontSize: 26, color: "#fdba74", fontWeight: 700 };
  return { fontSize: 22, color: "#cbd5e1" };
}

const KEYFRAMES = `
@keyframes rise { from { opacity:0; transform: translateY(24px) scale(.98);} to { opacity:1; transform:none; } }
@keyframes pop  { 0%{opacity:0; transform:scale(.6);} 60%{opacity:1; transform:scale(1.12);} 100%{transform:scale(1);} }
`;

const S: Record<string, React.CSSProperties> = {
  stage: {
    position: "fixed", inset: 0, background: "radial-gradient(1200px 800px at 50% -10%, #46306a, #241839 62%)",
    color: "#f8fafc", fontFamily: "system-ui, sans-serif", display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center", cursor: "pointer", userSelect: "none", overflow: "hidden",
  },
  center: { textAlign: "center", padding: 24, maxWidth: 900 },
  pop: { animation: "pop .7s both" },
  h1: { fontSize: 56, margin: "12px 0", fontWeight: 800, letterSpacing: -1 },
  sub: { color: "#b7aac9", fontSize: 20, margin: 6 },
  chTitle: { fontSize: 34, color: "#b499f2", marginBottom: 24, fontWeight: 700 },
  podium: { display: "flex", flexDirection: "column", gap: 14, alignItems: "center" },
  row: { display: "flex", gap: 16, alignItems: "center", justifyContent: "center" },
  medal: { fontSize: "1.2em" },
  team: {},
  pts: { color: "#64748b", fontSize: "0.6em", fontWeight: 600 },
  champ: { fontSize: 64, margin: "8px 0", fontWeight: 900, color: "#f6d079", letterSpacing: -1 },
  champPts: { color: "#a16207", fontSize: 28, fontWeight: 700 },
  hud: {
    position: "fixed", bottom: 28, left: 0, right: 0, display: "flex", gap: 20,
    alignItems: "center", justifyContent: "center", cursor: "default",
  },
  ghost: {
    background: "transparent", color: "#e7d9f5", border: "1px solid #4a3670",
    borderRadius: 999, padding: "8px 16px", fontSize: 14, cursor: "pointer",
  },
  dots: { display: "flex", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 999, background: "#4a3670" },
  dotOn: { background: "#f8fafc", transform: "scale(1.3)" },
  hint: { position: "fixed", top: 20, color: "#8b7fa5", fontSize: 13 },
};
