// Teams are optional (#79): a student without one plays solo, as a team of one. Like any
// team name, the one picked here shows in the results only once a teacher has checked it
// (ADR 0007).
import { useState } from "react";
import { api } from "../api.js";
import { qk, useRefresh } from "../query.js";
import { Button, Field, Notice, useAction } from "../ui.js";

export function PlaySolo({ heading = true }: { heading?: boolean }) {
  const refresh = useRefresh();
  const [name, setName] = useState("");
  const play = useAction(async () => {
    await api.createTeam(name.trim());
    await refresh(qk.student); // me (now in a team), the team list, the tab badges
  }, "Could not start playing solo.");
  return (
    <>
      {heading && <h3>Play solo</h3>}
      <p className="muted tiny mt-0">Play on your own: pick the name shown for you in the results. Your teacher checks it first.</p>
      <Field label="Your player name" value={name} onChange={(e) => setName(e.target.value)} />
      <Button size="block" disabled={!name.trim()} busy={play.busy} onClick={play.run}>Play solo</Button>
      <Notice tone="err">{play.error}</Notice>
    </>
  );
}
