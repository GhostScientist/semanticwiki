/**
 * Opt-in JSONL capture of local page attempts. Each record holds everything needed to
 * re-score or re-train from the attempt: prompt version, system prompt, user prompt,
 * evidence spans, response, stop reason, token usage and the page score.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export class TrajectoryWriter {
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  append(record: Record<string, unknown>): void {
    fs.appendFileSync(this.filePath, JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n');
  }
}
