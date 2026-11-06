/** Shared, verified GGUF downloads and hardware-aware local model selection. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, rm } from 'node:fs/promises';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { getRuntimePaths } from '../runtime-paths.js';
import { DEFAULT_LOCAL_MODEL_ID } from './defaults.js';
import type { HardwareProfile, ModelRecommendation, ModelFamily, ProgressCallback } from './types.js';
export type { ModelFamily } from './types.js';

interface ModelRegistryEntry extends ModelRecommendation { family: ModelFamily; }

const MODEL_REGISTRY: ModelRegistryEntry[] = [
  {
    family: 'semanticwiki',
    modelId: DEFAULT_LOCAL_MODEL_ID,
    ggufFile: 'semanticwiki-coder-7b-v2-q4_k_m.gguf',
    downloadUrl: 'https://huggingface.co/GhostScientist/semanticwiki-coder-7b-v2-gguf/resolve/e04e873741f29e5d8b80adf5d1dc6f3f848f6c00/semanticwiki-coder-7b-v2-q4_k_m.gguf',
    fileSizeBytes: 4_683_073_920,
    sha256: '333f4285f6af58d97bfaec3d22b27922b2993d9d54f1f24ea38e6d5358b60393',
    minVram: 6,
    minRam: 8,
    contextLength: 32768,
    quality: 'excellent',
  },
  // Retained for explicit selection and existing installations.
  {
    family: 'gpt-oss',
    modelId: 'gpt-oss-20b-semanticwiki-q8',
    ggufFile: 'gpt-oss-20b-semanticwiki-q8_0.gguf',
    downloadUrl: 'https://huggingface.co/GhostScientist/gpt-oss-20b-semanticwiki-gguf/resolve/main/gpt-oss-20b-semanticwiki-q8_0.gguf',
    fileSizeBytes: 22_261_912_096,
    sha256: 'd424387c4a6aca14f0124942a4436c879e47c2ed42ae14602e02b11040461a52',
    minVram: 24,
    minRam: 32,
    contextLength: 32768,
    quality: 'excellent',
  },
  {
    family: 'completion',
    modelId: 'qwen2.5-coder-1.5b-q8',
    ggufFile: 'qwen2.5-coder-1.5b-instruct-q8_0.gguf',
    downloadUrl: 'https://huggingface.co/Qwen/Qwen2.5-Coder-1.5B-Instruct-GGUF/resolve/main/qwen2.5-coder-1.5b-instruct-q8_0.gguf',
    fileSizeBytes: 1_894_532_160,
    sha256: '507de59046601282ba768a9789900e6ccf60ed93ddf346730b7c68eb0715bc47',
    minVram: 2,
    minRam: 4,
    contextLength: 32768,
    quality: 'good',
  },
];

export class ModelManager {
  private readonly modelsDir: string;
  private progressCallback?: ProgressCallback;
  private readonly downloads = new Map<string, Promise<string>>();

  constructor(options: { modelsDir?: string } = {}) {
    this.modelsDir = options.modelsDir ? path.resolve(options.modelsDir) : getRuntimePaths().modelsDir;
  }

  setProgressCallback(callback: ProgressCallback): void { this.progressCallback = callback; }
  getModelsDir(): string { return this.modelsDir; }

  async detectHardware(): Promise<HardwareProfile> {
    const hardware: HardwareProfile = {
      systemRam: os.totalmem() / 1024 ** 3,
      cpuCores: os.cpus().length,
      cpuModel: os.cpus()[0]?.model ?? 'Unknown',
      gpuVendor: 'none', gpuVram: 0,
    };
    try {
      const { getLlama } = await import('node-llama-cpp');
      const llama = await getLlama();
      const devices = await llama.getGpuDeviceNames();
      if (devices.length) {
        hardware.gpuName = devices[0];
        const name = hardware.gpuName.toLowerCase();
        hardware.gpuVendor = /nvidia|geforce|rtx|gtx/.test(name) ? 'nvidia'
          : /amd|radeon/.test(name) ? 'amd'
          : /apple|\bm\d/.test(name) ? 'apple'
          : /intel/.test(name) ? 'intel' : 'none';
        // Query actual memory instead of guessing from GPU marketing names.
        const memory = await llama.getVramState();
        hardware.gpuVram = memory.total / 1024 ** 3;
      }
    } catch {
      if (process.platform === 'darwin' && process.arch === 'arm64') {
        hardware.gpuVendor = 'apple';
        hardware.gpuName = 'Apple Silicon (unified memory)';
        hardware.gpuVram = Math.floor(hardware.systemRam * 0.7);
      }
    }
    return hardware;
  }

  getAvailableModels(family?: ModelFamily): ModelRecommendation[] {
    return MODEL_REGISTRY.filter(model => !family || model.family === family).map(model => ({ ...model }));
  }
  getModelsByFamily(family: ModelFamily): ModelRecommendation[] { return this.getAvailableModels(family); }
  getModelFamily(modelId: string): ModelFamily | undefined { return MODEL_REGISTRY.find(model => model.modelId === modelId)?.family; }
  getModelById(modelId: string): ModelRecommendation | undefined {
    const model = MODEL_REGISTRY.find(entry => entry.modelId === modelId);
    return model ? { ...model } : undefined;
  }

  recommendModel(hardware: HardwareProfile, family: ModelFamily = 'semanticwiki'): ModelRecommendation {
    const candidates = this.getAvailableModels(family).filter(model => hardware.gpuVram >= model.minVram || hardware.systemRam >= model.minRam);
    if (!candidates.length) {
      const requirements = this.getAvailableModels(family).map(model => `${model.minVram} GB VRAM or ${model.minRam} GB RAM`).join('; ');
      throw new Error(`No ${family} model fits this machine. Need ${requirements || 'a supported model family'}; detected ${hardware.gpuVram.toFixed(1)} GB VRAM and ${hardware.systemRam.toFixed(1)} GB RAM. Use --provider anthropic or --provider openai, or supply --model-path.`);
    }
    return candidates[0];
  }

  isModelDownloaded(modelId: string): boolean { return this.getModelPath(modelId) !== null; }
  getModelPath(modelId: string): string | null {
    const model = this.getModelById(modelId);
    if (!model) return null;
    const file = this.destination(model);
    try { return fs.statSync(file).isFile() && fs.statSync(file).size === model.fileSizeBytes ? file : null; }
    catch { return null; }
  }

  /** Full checksum validation; no network requests or mutations. */
  async verifyModel(modelOrId: ModelRecommendation | string): Promise<boolean> {
    const model = typeof modelOrId === 'string' ? this.getModelById(modelOrId) : modelOrId;
    if (!model) return false;
    return this.verifyFile(this.destination(model), model);
  }

  async ensureModel(model: ModelRecommendation): Promise<string> {
    const dest = this.destination(model);
    const pending = this.downloads.get(dest);
    if (pending) return pending;
    const operation = (async () => {
      if (await this.verifyFile(dest, model)) return dest;
      // Keep any old file intact until a complete, verified replacement is available.
      await this.downloadModel(model, dest);
      return dest;
    })();
    this.downloads.set(dest, operation);
    try { return await operation; } finally { this.downloads.delete(dest); }
  }

  private destination(model: ModelRecommendation): string {
    if (path.basename(model.ggufFile) !== model.ggufFile || !model.ggufFile.endsWith('.gguf')) {
      throw new Error('Model filename must be a GGUF filename without a directory.');
    }
    return path.join(this.modelsDir, model.ggufFile);
  }

  private async verifyFile(file: string, model: ModelRecommendation): Promise<boolean> {
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile() || stat.size !== model.fileSizeBytes) return false;
      if (!model.sha256) return true;
      const hash = createHash('sha256');
      for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
      return hash.digest('hex') === model.sha256;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  private async downloadModel(model: ModelRecommendation, destPath: string): Promise<void> {
    await mkdir(this.modelsDir, { recursive: true });
    const disk = await fs.promises.statfs(this.modelsDir);
    const available = disk.bavail * disk.bsize;
    const required = model.fileSizeBytes + 256 * 1024 ** 2;
    if (available < required) {
      throw new Error(`Not enough disk space for ${model.modelId}: need ${(required / 1024 ** 3).toFixed(2)} GiB including temporary headroom; ${(available / 1024 ** 3).toFixed(2)} GiB is available. Free space or set SEMANTICWIKI_MODELS_DIR to an absolute directory on another drive.`);
    }
    const partialPath = `${destPath}.${randomUUID()}.partial`;
    const controller = new AbortController();
    let idleTimer: NodeJS.Timeout;
    const resetIdleTimeout = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => controller.abort(), 120_000);
      idleTimer.unref();
    };
    resetIdleTimeout();
    try {
      this.progressCallback?.({ phase: 'downloading', percent: 0, message: `${model.modelId} → ${destPath}` });
      const response = await fetch(model.downloadUrl, { headers: { 'User-Agent': 'semanticwiki' }, signal: controller.signal });
      if (!response.ok) throw new Error(`Model download failed (${response.status} ${response.statusText}). Retry semanticwiki models prepare.`);
      if (!response.body) throw new Error('Model download returned no data.');
      const hash = createHash('sha256');
      let bytes = 0;
      let lastUpdate = 0;
      const report = this.progressCallback;
      const tracker = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          resetIdleTimeout();
          bytes += chunk.length;
          hash.update(chunk);
          if (bytes > model.fileSizeBytes) return callback(new Error('Model download exceeds its expected size.'));
          if (Date.now() - lastUpdate > 500) {
            report?.({ phase: 'downloading', percent: bytes / model.fileSizeBytes * 100, message: `${(bytes / 1e9).toFixed(2)} / ${(model.fileSizeBytes / 1e9).toFixed(2)} GB` });
            lastUpdate = Date.now();
          }
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>), tracker, fs.createWriteStream(partialPath, { flags: 'wx' }));
      if (bytes !== model.fileSizeBytes) throw new Error(`Incomplete model download: expected ${model.fileSizeBytes} bytes, received ${bytes}.`);
      const checksum = hash.digest('hex');
      if (model.sha256 && checksum !== model.sha256) throw new Error('Model checksum mismatch. Download discarded; retry semanticwiki models prepare.');
      await rename(partialPath, destPath);
      this.progressCallback?.({ phase: 'downloaded', percent: 100, message: destPath });
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Model download stalled for two minutes. Check your connection and retry semanticwiki models prepare.');
      if ((error as NodeJS.ErrnoException).code === 'ENOSPC') throw new Error('The model download ran out of disk space. Its partial file was removed. Free space or set SEMANTICWIKI_MODELS_DIR to another drive, then retry semanticwiki models prepare.');
      throw error;
    } finally {
      clearTimeout(idleTimer!);
      await rm(partialPath, { force: true });
    }
  }

  deleteModel(modelId: string): boolean {
    const model = this.getModelById(modelId);
    if (!model) return false;
    try { fs.unlinkSync(this.destination(model)); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }

  listDownloadedModels(): Array<{ model: ModelRecommendation; path: string; sizeBytes: number }> {
    return this.getAvailableModels().flatMap(model => {
      const file = this.getModelPath(model.modelId);
      return file ? [{ model, path: file, sizeBytes: fs.statSync(file).size }] : [];
    });
  }

  formatHardwareProfile(hardware: HardwareProfile): string {
    return [hardware.gpuName ? `GPU: ${hardware.gpuName} (${hardware.gpuVram.toFixed(1)} GB VRAM)` : 'GPU: CPU-only mode',
      `RAM: ${hardware.systemRam.toFixed(0)} GB`, `CPU: ${hardware.cpuModel} (${hardware.cpuCores} cores)`].join('\n');
  }
}
export default ModelManager;
