import { useState } from "react";
import { Link } from "react-router-dom";
import { api, HttpError, type TeamView } from "../api.js";
import { qk, useMe, useMyChallenges, useRefresh, useTeams } from "../query.js";
import { PlaySolo } from "./PlaySolo.js";
import {
  Button, Card, CheckRow, EmptyState, ErrorCard, Field, Skeleton, Stepper, type Step,
} from "../ui.js";

export function TeamPage() {
  const me = useMe();
  const teams = useTeams();
  // Preview only: the team screen works without it.
  const challenges = useMyChallenges();
  const refresh = useRefresh();
  const [name, setName] = useState("");
  const [err, setErr] = useState("");

  if (me.loading || teams.loading) return <Card><Skeleton lines={4} /></Card>;
  // A failed load is not a phase: never claim "locked" because a request failed (#67).
  if (me.error || teams.error || !me.data) {
    return <ErrorCard error={me.error ?? teams.error} onRetry={() => { me.reload(); teams.reload(); }} />;
  }
  const { phase, teamId } = me.data;
  const locked = phase !== "draft";
  const myTeam = teamId ? teams.data?.teams.find((t) => t.id === teamId) : undefined;

  const act = (fn: () => Promise<unknown>) => async () => {
    setErr("");
    try {
      await fn();
      await refresh(qk.student); // my team, the team list, the tab badge
    } catch (e) {
      setErr(e instanceof HttpError ? e.reason : "Une erreur est survenue.");
    }
  };

  if (teamId) {
    const preview = challenges.data?.challenges ?? [];
    return (
      <div className="stack">
        <TeamHero team={myTeam} />
        <Card>
          <Stepper steps={stepsFor(phase)} />
          <NextLink phase={phase} />
        </Card>
        {!locked && preview.length > 0 && (
          <Card>
            <h3>À venir</h3>
            {preview.map((c) => <CheckRow key={c.id} state="todo" title={c.title} />)}
          </Card>
        )}
        {!locked && (
          <div className="center">
            <Button variant="ghost" onClick={act(() => api.leaveTeam())}>Quitter l'équipe</Button>
            {err && <p className="err tiny">{err}</p>}
          </div>
        )}
      </div>
    );
  }

  // Teams locked, none joined: during photo time the student plays solo (#79).
  if (locked && phase === "challenge") {
    return <Card hero><PlaySolo /></Card>;
  }
  if (locked) {
    return (
      <Card>
        <EmptyState icon="🔒" title="Les équipes sont verrouillées">
          {phase === "voting"
            ? <Link to="/vote" className="btn">Aller voter →</Link>
            : <span className="muted tiny">Tu pourras quand même voter à l'ouverture des votes.</span>}
        </EmptyState>
      </Card>
    );
  }

  const list = teams.data?.teams ?? [];
  return (
    <div className="stack">
      <Card hero>
        <h2>Choisis ton équipe</h2>
        <Field label="Nom de la nouvelle équipe" value={name} onChange={(e) => setName(e.target.value)} />
        <Button size="block" disabled={!name.trim()} onClick={act(() => api.createTeam(name.trim()))}>Créer l'équipe</Button>
        <p className="muted tiny" style={{ marginBottom: 0 }}>Tu joues en solo ? Crée une équipe rien que pour toi.</p>
        {err && <p className="err tiny" style={{ marginBottom: 0 }}>{err}</p>}
      </Card>
      <Card>
        <h3>Ou rejoins-en une</h3>
        {list.length === 0 && <EmptyState icon="🧑‍🤝‍🧑" title="Pas encore d'équipe" />}
        {list.map((t) => (
          <div key={t.id} className="list-row">
            <div className="grow">
              <b>{t.name}</b>
              <div className="d">{members(t.members)}</div>
            </div>
            <Button onClick={act(() => api.joinTeam(t.id))}>Rejoindre</Button>
          </div>
        ))}
      </Card>
    </div>
  );
}

const members = (n: number) => `${n} ${n === 1 ? "membre" : "membres"}`;

function TeamHero({ team }: { team?: TeamView }) {
  return (
    <Card hero>
      <div className="row">
        <span className="crest">🦊</span>
        <div>
          <h2>{team?.name ?? "Ton équipe"}</h2>
          {team && <div className="muted tiny">{members(team.members)}</div>}
        </div>
      </div>
    </Card>
  );
}

/** The road ahead from the student's point of view; the current step glows. */
function stepsFor(phase: string): Step[] {
  const labels = phase === "draft"
    ? ["Équipe rejointe", "Attendre le départ", "Relever les défis", "Voter pour les meilleures"]
    : ["Équipe rejointe", "Relever les défis", "Voter pour les meilleures", "Gagnants dévoilés"];
  const current = phase === "draft" || phase === "challenge" ? 1 : phase === "voting" ? 2 : 3;
  return labels.map((label, i) => ({
    label,
    state: i < current ? "done" : i === current ? "current" : "upcoming",
  }));
}

function NextLink({ phase }: { phase: string }) {
  if (phase === "challenge") return <Link to="/challenges" className="btn btn-block" style={{ marginTop: 12 }}>Voir tes défis →</Link>;
  if (phase === "voting") return <Link to="/vote" className="btn btn-block" style={{ marginTop: 12 }}>Aller voter →</Link>;
  return null;
}
