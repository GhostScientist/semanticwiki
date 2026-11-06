import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { ModelManager } from '../src/llm/model-manager.js';
import type { ModelRecommendation } from '../src/llm/types.js';

let directory: string;
let manager: ModelManager;
const contents = Buffer.from('GGUF-small-test-model');
const model: ModelRecommendation = {
  modelId: 'fixture', ggufFile: 'fixture.gguf', downloadUrl: 'https://example.test/fixture.gguf',
  fileSizeBytes: contents.length, sha256: createHash('sha256').update(contents).digest('hex'),
  minVram: 6, minRam: 8, contextLength: 32768, quality: 'excellent',
};

beforeEach(() => { directory = mkdtempSync(path.join(os.tmpdir(), 'semanticwiki-models-')); manager = new ModelManager({ modelsDir: directory }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); rmSync(directory, { recursive: true, force: true }); });

describe('model downloads', () => {
  it('recommends the requested pinned 7B v2 model instead of the 20B model', () => {
    const selected = manager.recommendModel({ gpuVendor: 'none', gpuVram: 0, systemRam: 16, cpuCores: 8 });
    expect(selected.modelId).toBe('semanticwiki-coder-7b-v2');
    expect(selected.fileSizeBytes).toBe(4_683_073_920);
    expect(selected.downloadUrl).toContain('/resolve/e04e873741f29e5d8b80adf5d1dc6f3f848f6c00/');
    expect(selected.sha256).toHaveLength(64);
  });

  it('does not claim an undersized machine can run the default model', () => {
    expect(() => manager.recommendModel({ gpuVendor: 'none', gpuVram: 0, systemRam: 4, cpuCores: 2 })).toThrow('6 GB VRAM or 8 GB RAM');
  });

  it('publishes only a complete verified download and reuses it without fetching again', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response(contents)));
    vi.stubGlobal('fetch', fetcher);
    const [first, second] = await Promise.all([manager.ensureModel(model), manager.ensureModel(model)]);
    expect(first).toBe(second);
    expect(readFileSync(first)).toEqual(contents);
    expect(await manager.verifyModel(model)).toBe(true);
    await manager.ensureModel(model);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(readdirSync(directory)).toEqual(['fixture.gguf']);
  });

  it.each(['short', 'corrupt'])('discards a %s download and preserves an existing file', async mode => {
    const destination = path.join(directory, model.ggufFile);
    writeFileSync(destination, 'existing-model');
    const downloaded = mode === 'short' ? contents.subarray(0, 5) : Buffer.alloc(contents.length, 42);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(downloaded)));
    await expect(manager.ensureModel(model)).rejects.toThrow(mode === 'short' ? 'Incomplete' : 'checksum');
    expect(readFileSync(destination, 'utf8')).toBe('existing-model');
    expect(readdirSync(directory)).toEqual(['fixture.gguf']);
  });

  it('rejects a registry path escaping shared storage', async () => {
    await expect(manager.ensureModel({ ...model, ggufFile: '../outside.gguf' })).rejects.toThrow('without a directory');
  });

  it('aborts a stalled connection and leaves no partial weights', async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    vi.stubGlobal('fetch', fetcher);
    const outcome = expect(manager.ensureModel(model)).rejects.toThrow('stalled for two minutes');
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(120_000);
    await outcome;
    expect(readdirSync(directory)).toEqual([]);
  });

  it('reports insufficient disk space before starting a large transfer', async () => {
    vi.spyOn(fs.promises, 'statfs').mockResolvedValue({ bavail: 1, bsize: 1024 } as any);
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(manager.ensureModel(model)).rejects.toThrow('Not enough disk space');
    expect(fetcher).not.toHaveBeenCalled();
    expect(readdirSync(directory)).toEqual([]);
  });
});
