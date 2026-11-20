import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";

export type TurnReport = { summary: string; errorMessage?: string };

function reportPath(activityFile: string, sequence: number): string {
  return `${activityFile}.turn-${sequence}`;
}

export function writeTurnReport(activityFile: string, sequence: number, report: TurnReport): void {
  const path = reportPath(activityFile, sequence);
  const temp = `${path}.tmp`;
  writeFileSync(temp, JSON.stringify(report), { mode: 0o600 });
  renameSync(temp, path);
}

export function takeTurnReport(activityFile: string, sequence: number): TurnReport | undefined {
  const path = reportPath(activityFile, sequence);
  try {
    const report = JSON.parse(readFileSync(path, "utf8"));
    unlinkSync(path);
    return report;
  } catch {
    return undefined;
  }
}
