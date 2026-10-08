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
  if (!data.data) return <div className="qr-sheet"><p className="err">Not found.</p></div>;
  const { trip, challenges } = data.data;

  return (
    <div className="qr-sheet">
      <header className="qr-sheet-head no-print">
        <h1>{trip.name} — QR codes</h1>
        <p className="muted">One card per challenge. Print, cut along the dashed lines, and place them on the route.</p>
        <Button onClick={() => window.print()}>Print</Button>
      </header>
      <div className="qr-cards">
        {challenges.map((c) => (
          <article key={c.id} className="qr-card" aria-labelledby={`qr-${c.id}`}>
            <h2 id={`qr-${c.id}`}>{c.title}</h2>
            {Number(c.multiplier) !== 1 && <p className="qr-mult">×{c.multiplier} points</p>}
            <img src={api.qrUrl(c.id)} alt={`QR code for ${c.title}`} />
            {c.instructions && <p className="qr-instr">{c.instructions}</p>}
            <p className="qr-trip">{trip.name}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
