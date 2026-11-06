import type { ProgressCallback } from './llm/types.js';

/** Visible, bounded progress for long first-use downloads; never contaminates stdout. */
export function modelProgressReporter(): ProgressCallback {
  let previousPhase = '';
  let previousPercent = -5;
  return progress => {
    const percent = progress.percent === undefined ? undefined : Math.floor(progress.percent);
    if (progress.phase !== previousPhase || percent === 100 || (percent !== undefined && percent >= previousPercent + 5)) {
      console.error(`[${progress.phase}] ${percent === undefined ? '' : `${percent}% `}${progress.message || ''}`);
      previousPhase = progress.phase;
      previousPercent = percent ?? -5;
    }
  };
}
