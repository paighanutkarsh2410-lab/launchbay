import { useQuery } from "@tanstack/react-query";
import { api, type Grade, type ScoreSummary } from "./api";

export const gradeColor: Record<Grade, string> = {
  Gold: "#fbbf24",
  Silver: "#cbd5e1",
  Bronze: "#e0915c",
  "Needs work": "#fb7185",
};

/** Scores for every launched service, keyed by name. Missing entries just render nothing. */
export function useScores(): Record<string, ScoreSummary> {
  const { data = [] } = useQuery({ queryKey: ["scorecards"], queryFn: api.scorecards, staleTime: 60_000 });
  return Object.fromEntries(data.map((s) => [s.service, s]));
}
