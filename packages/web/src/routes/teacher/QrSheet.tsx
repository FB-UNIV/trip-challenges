// Printable QR sheet: one cut-out card per challenge (title, instructions, QR). Opened in its
// own tab outside the app chrome, so only the cards reach the printer.
import { useParams } from "react-router-dom";
import { api } from "../../api.js";
import { Button, Skeleton, useAsync } from "../../ui.js";

export function QrSheet() {
  const { id } = useParams();
  const data = useAsync(async () => {
    const trip = await api.getTrip(id!); // first: no point listing an unknown trip's challenges
    return { trip, challenges: (await api.listChallenges(id!)).challenges };
  }, [id]);
  if (data.loading) return <div className="qr-sheet"><Skeleton /></div>;
  if (!data.data) return <div className="qr-sheet"><p className="err">Sortie introuvable.</p></div>;
  const { trip, challenges } = data.data;

  return (
    <div className="qr-sheet">
      <header className="qr-sheet-head no-print">
        <h1>{trip.name} — QR codes</h1>
        <p className="muted">Une carte par défi. Imprime, découpe le long des pointillés et place-les sur le parcours.</p>
        <Button onClick={() => window.print()}>Imprimer</Button>
      </header>
      <div className="qr-cards">
        {challenges.map((c) => (
          <article key={c.id} className="qr-card" aria-labelledby={`qr-${c.id}`}>
            <h2 id={`qr-${c.id}`}>{c.title}</h2>
            {Number(c.multiplier) !== 1 && <p className="qr-mult">×{c.multiplier} points</p>}
            <img src={api.qrUrl(c.id)} alt={`QR code du défi ${c.title}`} />
            {c.instructions && <p className="qr-instr">{c.instructions}</p>}
            <p className="qr-trip">{trip.name}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
