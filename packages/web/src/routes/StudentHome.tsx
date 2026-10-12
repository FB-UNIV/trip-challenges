import { useState } from "react";
import { Link } from "react-router";
import { api, errorText, HttpError, isBadCode } from "../api.js";
import { qk, useMe, useRefresh, useTeams } from "../query.js";
import { Button, Card, ErrorCard, Field, PhasePill, PhaseTrail, Skeleton } from "../ui.js";
import { PlaySolo } from "./PlaySolo.js";

export function StudentHome() {
  const { data: me, error, loading, reload } = useMe();
  const teams = useTeams();
  const refresh = useRefresh();
  const [code, setCode] = useState("");
  const [msg, setMsg] = useState("");

  if (loading) return <Card><Skeleton /></Card>;

  // Not logged in -> offer manual code entry (QR/email link is the usual path).
  if (error instanceof HttpError && error.status === 401) {
    return (
      <Card hero>
        <h2>Saisis ton code d'accès</h2>
        <p className="muted tiny" style={{ margin: "6px 0 12px" }}>
          En général, tu ouvres le lien reçu par e-mail ou tu scannes le QR code d'un défi.
        </p>
        <Field
          label="Code d'accès" className="input-mono" value={code}
          placeholder="FOX-7Q2K" onChange={(e) => setCode(e.target.value)}
        />
        <Button
          size="block" style={{ marginTop: 4 }}
          onClick={async () => {
            try { await api.redeemCode(code.trim()); await refresh(qk.student); }
            catch (e) { setMsg(isBadCode(e) ? "Ce code n'est pas valide ou a déjà été utilisé." : errorText(e)); }
          }}
        >
          Continuer
        </Button>
        {msg && <p className="err tiny" style={{ marginBottom: 0 }}>{msg}</p>}
        <p className="tiny" style={{ marginTop: 16, marginBottom: 0 }}>
          <Link to="/teacher">Je suis enseignant →</Link>
        </p>
      </Card>
    );
  }

  if (error || !me) return <ErrorCard error={error} onRetry={reload} />;
  const teamName = me.teamId ? teams.data?.teams.find((t) => t.id === me.teamId)?.name : null;

  return (
    <div className="stack">
      <div style={{ padding: "2px 2px 6px" }}>
        <PhaseTrail phase={me.phase} variant="student" />
      </div>

      <Card hero>
        <div className="row">
          <span className="crest">{me.teamId ? "🦊" : "🧭"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="tiny muted">{me.tripName}</div>
            <h2 style={{ margin: "2px 0 0" }}>{teamName ?? (me.teamId ? "Ton équipe" : "Pas encore d'équipe")}</h2>
          </div>
          <PhasePill phase={me.phase} dot />
        </div>
      </Card>

      <NextAction phase={me.phase} inTeam={!!me.teamId} />
    </div>
  );
}

function NextAction({ phase, inTeam }: { phase: string; inTeam: boolean }) {
  if (phase === "draft") {
    return (
      <Card>
        <Action icon="🧑‍🤝‍🧑" title="Fais équipe ou joue en solo" body="Rejoins ou crée une équipe avant le début des défis. Tu joues en solo ? Crée une équipe rien que pour toi." />
        <Link to="/team"><Button size="block" style={{ marginTop: 12 }}>Voir les équipes</Button></Link>
      </Card>
    );
  }
  if (phase === "challenge") {
    return (
      <Card>
        <Action icon="📸" title="Relève les défis" body="Prends une photo pour chaque défi, puis sélectionne ta meilleure." />
        {inTeam
          ? <Link to="/challenges"><Button size="block" style={{ marginTop: 12 }}>Voir tes défis</Button></Link>
          : <div className="mt-3"><PlaySolo heading={false} /></div>}
      </Card>
    );
  }
  if (phase === "voting") {
    return (
      <Card>
        <Action icon="⚖️" title="Vote pour les duels" body="Choisis la meilleure photo, autant de fois que tu veux." />
        <Link to="/vote"><Button size="block" style={{ marginTop: 12 }}>Commencer à voter</Button></Link>
      </Card>
    );
  }
  return (
    <Card>
      <Action icon="🏆" title="Les résultats sont là" body="Demande à ton enseignant de dévoiler les gagnants sur grand écran !" />
    </Card>
  );
}

function Action({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
      <span className="action-ic">{icon}</span>
      <div>
        <h3>{title}</h3>
        <p className="muted tiny" style={{ margin: "3px 0 0" }}>{body}</p>
      </div>
    </div>
  );
}
