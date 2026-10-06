// RED stub — interface only.
export const DEMO_PREFIX = "[DEMO] ";
export type SeedOptions = {
  teacherEmail: string; teams?: number; studentsPerTeam?: number; joinLinks?: number;
  photosPerTeam?: number; votesPerStudent?: number;
};
export type SeededTrip = { id: string; name: string; phase: string; adminUrl: string; ceremonyUrl: string; joinLinks: string[] };
export async function seedDemo(_opts: SeedOptions): Promise<{ trips: SeededTrip[] }> {
  return { trips: [] };
}
export async function eraseDemo(): Promise<string[]> {
  return [];
}
