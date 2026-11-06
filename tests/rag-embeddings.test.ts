import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'node:child_process';
import { Tensor } from '@huggingface/transformers';
import type { CodeChunk, RAGSystem } from '../src/rag/index.js';

const mocks = vi.hoisted(() => ({
  nativeAvailable: true,
  config: vi.fn(),
  model: vi.fn(),
  tokenizer: vi.fn(),
  tokenize: vi.fn(),
  infer: vi.fn(),
  pipeline: vi.fn(),
  legacyInfer: vi.fn(),
  constructIndex: vi.fn(),
  readIndex: vi.fn(),
  add: vi.fn(),
  write: vi.fn(),
  search: vi.fn()
}));

vi.mock('@huggingface/transformers', async () => {
  const { Tensor } = await vi.importActual<typeof import('@huggingface/transformers')>('@huggingface/transformers');
  return {
    Tensor,
    env: {},
    AutoConfig: { from_pretrained: mocks.config },
    AutoModel: { from_pretrained: mocks.model },
    AutoTokenizer: { from_pretrained: mocks.tokenizer },
    pipeline: mocks.pipeline
  };
});

vi.mock('module', () => ({
  createRequire: () => () => {
    if (!mocks.nativeAvailable) throw new Error('Native index unavailable');
    return {
    IndexFlatIP: Object.assign(class {
      constructor(private dimension: number) {
        mocks.constructIndex(dimension);
      }
      getDimension() { return this.dimension; }
      add(vectors: number[]) { mocks.add(vectors); }
      write(file: string) { mocks.write(file); }
      search(vector: number[], count: number) { return mocks.search(vector, count); }
    }, { read: mocks.readIndex })
    };
  }
}));

describe('EmbeddingGemma 2 code embeddings', () => {
  let root: string;
  let store: string;
  let rag: RAGSystem;
  let RAG: typeof RAGSystem;
  let defaultModel: string;
  const chunk: CodeChunk = {
    id: 'src/auth.ts:1-5',
    filePath: 'src/auth.ts',
    startLine: 1,
    endLine: 5,
    content: 'export function authenticate(token: string) { return token.length > 0; }',
    language: 'typescript',
    domainContext: 'Authentication and authorization',
    documentation: 'Check an authentication token'
  };

  function tensor(dimension = 768, value = 0.1): Tensor {
    return new Tensor('float32', new Float32Array(dimension).fill(value), [1, dimension]);
  }

  function cachedState(model = defaultModel, dimension = 768) {
    return {
      commitHash: 'old-commit',
      indexedAt: '2026-01-01T00:00:00.000Z',
      fileCount: 1,
      chunkCount: 1,
      embeddingModel: model,
      embeddingDimension: dimension,
      hasHybridIndex: true
    };
  }

  function seedCache(model = defaultModel, dimension = 768) {
    fs.writeFileSync(path.join(store, 'metadata.json'), JSON.stringify({ 0: chunk }));
    fs.writeFileSync(path.join(store, 'index-state.json'), JSON.stringify(cachedState(model, dimension)));
    fs.writeFileSync(path.join(store, 'index.faiss'), 'cached index');
    mocks.readIndex.mockReturnValue({
      getDimension: () => dimension,
      search: mocks.search
    });
  }

  beforeEach(async () => {
    vi.resetModules();
    vi.resetAllMocks();
    mocks.nativeAvailable = true;
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'semanticwiki-embeddings-'));
    store = path.join(root, 'store');
    mocks.config.mockResolvedValue({ vision_config: {}, audio_config: {} });
    mocks.model.mockResolvedValue(mocks.infer);
    mocks.tokenizer.mockResolvedValue(mocks.tokenize);
    mocks.tokenize.mockReturnValue({ input_ids: 'tokens' });
    mocks.infer.mockResolvedValue({
      sentence_embedding: tensor(),
      last_hidden_state: tensor(512)
    });
    mocks.pipeline.mockResolvedValue(mocks.legacyInfer);
    mocks.legacyInfer.mockResolvedValue(tensor(384));
    mocks.write.mockImplementation(file => fs.writeFileSync(file, 'new index'));
    mocks.search.mockReturnValue({ labels: [0], distances: [0.9] });
    const module = await import('../src/rag/index.js');
    RAG = module.RAGSystem;
    defaultModel = module.DEFAULT_EMBEDDING_MODEL;
    rag = new RAG({ storePath: store, repoPath: root });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('uses the ONNX release, text-only q4 CPU inference, and projected 768d output', async () => {
    expect(rag.getSearchConfig().embeddingModel).toBe('onnx-community/embeddinggemma-2-ONNX');
    const vectors = await rag['generateEmbeddings']([chunk]);
    expect(mocks.model).toHaveBeenCalledWith(defaultModel, {
      config: { vision_config: null, audio_config: null },
      device: 'cpu',
      dtype: 'q4'
    });
    expect(mocks.tokenize).toHaveBeenCalledWith(
      `title: src/auth.ts | text: ${chunk.domainContext}\n\n${chunk.documentation}\n\n${chunk.content}`,
      { padding: true, truncation: true, max_length: 8192 }
    );
    expect(vectors[0]).toHaveLength(768);
    expect(Math.hypot(...vectors[0])).toBeCloseTo(1, 6);
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });

  it('maps the original Google model ID to its runnable ONNX release', () => {
    const google = new RAG({ storePath: store, repoPath: root, embeddingModel: 'google/embeddinggemma-2' });
    expect(google.getSearchConfig().embeddingModel).toBe(defaultModel);
  });

  it('uses the code-retrieval query prefix and does not truncate at the old character limit', async () => {
    const query = 'code '.repeat(600);
    await rag['generateSingleEmbedding'](query);
    expect(mocks.tokenize).toHaveBeenCalledWith(`task: code retrieval | query: ${query}`, expect.any(Object));
    await rag['generateEmbeddings']([{ ...chunk, content: 'source '.repeat(600) }]);
    expect(mocks.tokenize.mock.calls[1][0]).toContain('source '.repeat(600));
  });

  it('shares a pending model load only across instances using the same model', async () => {
    const same = new RAG({ storePath: store, repoPath: root });
    const custom = new RAG({ storePath: store, repoPath: root, embeddingModel: 'Xenova/custom-model' });
    const [gemma, otherGemma, legacy] = await Promise.all([
      rag['generateSingleEmbedding']('authenticate'),
      same['generateSingleEmbedding']('token'),
      custom['generateSingleEmbedding']('custom')
    ]);
    expect(mocks.model).toHaveBeenCalledTimes(1);
    expect(mocks.pipeline).toHaveBeenCalledWith('feature-extraction', 'Xenova/custom-model');
    expect(mocks.legacyInfer).toHaveBeenCalledWith('custom', { pooling: 'mean', normalize: true });
    expect(gemma).toHaveLength(768);
    expect(otherGemma).toHaveLength(768);
    expect(legacy).toHaveLength(384);
  });

  it('surfaces loading failures without silently substituting another model, and permits retry', async () => {
    mocks.model.mockRejectedValueOnce(new Error('Download failed'));
    await expect(rag['generateSingleEmbedding']('query')).rejects.toThrow(`Failed to load embedding model ${defaultModel}`);
    expect(mocks.pipeline).not.toHaveBeenCalled();
    expect(rag.getSearchConfig().embeddingModel).toBe(defaultModel);
    await expect(rag['generateSingleEmbedding']('query')).resolves.toHaveLength(768);
  });

  it('stops on a partially failed batch without appending zero or misaligned vectors', async () => {
    mocks.infer.mockResolvedValueOnce({ sentence_embedding: tensor() })
      .mockRejectedValueOnce(new Error('Inference failed'));
    await expect(rag['generateEmbeddings']([chunk, { ...chunk, id: 'second' }]))
      .rejects.toThrow('Failed to embed chunk second');
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it.each([
    ['wrong dimensions', () => tensor(512)],
    ['zero vector', () => tensor(768, 0)],
    ['non-finite vector', () => tensor(768, Number.NaN)],
    ['unpooled output', () => new Tensor('float32', new Float32Array(768), [1, 2, 384])]
  ])('rejects %s', async (_, output) => {
    mocks.infer.mockResolvedValue({ sentence_embedding: output() });
    await expect(rag['generateSingleEmbedding']('query')).rejects.toThrow();
  });

  it('requires the current model and dimensions for cache compatibility', () => {
    expect(rag.isIndexCompatible(cachedState())).toBe(true);
    expect(rag.isIndexCompatible(cachedState('Xenova/bge-small-en-v1.5', 384))).toBe(false);
    expect(rag.isIndexCompatible(cachedState(defaultModel, 512))).toBe(false);
    expect(rag.isIndexCompatible({ ...cachedState(), embeddingDimension: undefined })).toBe(false);
    expect(rag.isIndexCompatible(null)).toBe(false);
  });

  it('does not index downloaded model assets as source files', async () => {
    const modelCache = path.join(root, '.semanticwiki-models', 'onnx-community');
    fs.mkdirSync(modelCache, { recursive: true });
    fs.writeFileSync(path.join(modelCache, 'tokenizer.json'), '{"model": "cached tokenizer"}');
    fs.writeFileSync(path.join(root, 'auth.ts'), chunk.content);
    expect(await rag['discoverFiles']()).toEqual(['auth.ts']);
  });

  it('reuses a compatible cache and searches with a matching query vector', async () => {
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, chunk.filePath), chunk.content);
    await rag.indexRepository();
    mocks.model.mockClear();
    mocks.readIndex.mockReturnValue({ getDimension: () => 768, search: mocks.search });
    rag = new RAG({ storePath: store, repoPath: root });
    await rag.indexRepository();
    expect(mocks.readIndex).toHaveBeenCalledTimes(1);
    expect(mocks.model).not.toHaveBeenCalled();
    const results = await rag.search('authenticate', { mode: 'vector' });
    expect(results[0].filePath).toBe(chunk.filePath);
    expect(mocks.search.mock.calls[0][0]).toHaveLength(768);
  });

  it('rebuilds legacy caches with no source identity even when their model is compatible', async () => {
    seedCache();
    fs.writeFileSync(path.join(root, 'auth.ts'), chunk.content);
    await rag.indexRepository();
    expect(mocks.readIndex).not.toHaveBeenCalled();
    expect(rag.getIndexState()?.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('invalidates source edits even when file size, modification time, and Git commit are unchanged', async () => {
    const source = path.join(root, 'auth.ts');
    fs.writeFileSync(source, chunk.content);
    const stat = fs.statSync(source);
    await rag.indexRepository();
    const previous = rag.getIndexState()?.sourceFingerprint;
    fs.writeFileSync(source, chunk.content.replace('token', 'value'));
    fs.utimesSync(source, stat.atime, stat.mtime);
    mocks.constructIndex.mockClear();
    await rag.indexRepository();
    expect(mocks.readIndex).not.toHaveBeenCalled();
    expect(mocks.constructIndex).toHaveBeenCalled();
    expect(rag.getIndexState()?.sourceFingerprint).not.toBe(previous);
    expect((await rag.search('value', { mode: 'keyword' }))[0].content).toContain('value');
  });

  it('reindexes added and removed files, including non-Git repositories, and clears an empty index', async () => {
    fs.writeFileSync(path.join(root, 'auth.ts'), chunk.content);
    await rag.indexRepository();
    fs.writeFileSync(path.join(root, 'new.ts'), 'export function newFeature() { return "A newly discovered code path in an untracked source file"; }');
    await rag.indexRepository();
    expect(rag.getIndexedFiles()).toContain('new.ts');
    fs.unlinkSync(path.join(root, 'auth.ts'));
    fs.unlinkSync(path.join(root, 'new.ts'));
    await rag.indexRepository();
    expect(rag.getDocumentCount()).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(store, 'metadata.json'), 'utf8'))).toEqual({});
    expect(fs.existsSync(path.join(store, 'index.faiss'))).toBe(false);
  });

  it('removes stale cached metadata when an incremental update deletes every source file', async () => {
    seedCache();
    const result = await rag.updateIndex([chunk.filePath]);
    expect(result).toMatchObject({ chunksRemoved: 1, chunksAdded: 0 });
    expect(rag.getDocumentCount()).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(store, 'metadata.json'), 'utf8'))).toEqual({});
    expect(fs.existsSync(path.join(store, 'index.faiss'))).toBe(false);
    expect(await rag.search('authenticate', { mode: 'keyword' })).toEqual([]);
    expect(mocks.model).not.toHaveBeenCalled();
  });

  it('does not reuse another checkout or different indexing settings in the same output directory', async () => {
    fs.writeFileSync(path.join(root, 'auth.ts'), chunk.content);
    await rag.indexRepository();
    const previous = rag.getIndexState()?.repositoryId;
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'semanticwiki-other-'));
    try {
      fs.writeFileSync(path.join(other, 'auth.ts'), chunk.content);
      const otherRag = new RAG({ storePath: store, repoPath: other });
      await otherRag.indexRepository();
      expect(otherRag.getIndexState()?.repositoryId).not.toBe(previous);
      expect(mocks.readIndex).not.toHaveBeenCalled();
      const previousConfiguration = otherRag.getIndexState()?.indexConfiguration;
      const changedConfig = new RAG({ storePath: store, repoPath: other, chunkSize: 900 });
      await changedConfig.indexRepository();
      expect(changedConfig.getIndexState()?.indexConfiguration).not.toBe(previousConfiguration);
      expect(mocks.readIndex).not.toHaveBeenCalled();
    } finally { fs.rmSync(other, { recursive: true, force: true }); }
  });

  it('detects committed, dirty, and untracked changes in a Git checkout', async () => {
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=SemanticWiki Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, stdio: 'ignore' });
    git('init', '-q');
    fs.writeFileSync(path.join(root, 'auth.ts'), chunk.content);
    git('add', 'auth.ts');
    git('commit', '-qm', 'Initial fixture');
    await rag.indexRepository();
    const firstCommit = rag.getIndexState()?.commitHash;
    fs.writeFileSync(path.join(root, 'auth.ts'), chunk.content.replace('token', 'other'));
    await rag.indexRepository();
    expect(rag.getIndexState()?.commitHash).toBe(firstCommit);
    fs.writeFileSync(path.join(root, 'untracked.ts'), 'export function untrackedFeature() { return "New code that has not yet been committed to Git"; }');
    await rag.indexRepository();
    expect(rag.getIndexedFiles()).toContain('untracked.ts');
    git('add', 'auth.ts', 'untracked.ts');
    git('commit', '-qm', 'Changed fixture');
    await rag.indexRepository();
    expect(rag.getIndexState()?.commitHash).not.toBe(firstCommit);
    expect(mocks.readIndex).not.toHaveBeenCalled();
  });

  it('omits generated wiki output and internal cache files from source discovery', async () => {
    const wiki = path.join(root, 'docs', 'architecture');
    const cache = path.join(wiki, '.semanticwiki-cache');
    const nestedRag = new RAG({ storePath: cache, repoPath: root });
    fs.writeFileSync(path.join(wiki, 'README.md'), '# Generated wiki');
    fs.writeFileSync(path.join(cache, 'metadata.json'), '{}');
    fs.writeFileSync(path.join(root, 'auth.ts'), chunk.content);
    expect(await nestedRag['discoverFiles']()).toEqual(['auth.ts']);
  });

  it('keeps explicit metadata-only loading available even after source files change', async () => {
    seedCache();
    fs.writeFileSync(path.join(root, 'different.ts'), 'export const sourceHasChanged = true;');
    await rag.loadMetadataOnly();
    expect(mocks.readIndex).toHaveBeenCalledTimes(1);
    expect(rag.getIndexedFiles()).toEqual([chunk.filePath]);
  });

  it('keeps keyword-only loading model-free and routes diagnostics away from stdout', async () => {
    seedCache('Xenova/bge-small-en-v1.5', 384);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => {});
    const loggingRag = new RAG({ storePath: store, repoPath: root, logToStderr: true });
    await loggingRag.loadMetadataOnly({ migrateEmbeddings: false });
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.pipeline).not.toHaveBeenCalled();
    expect(mocks.readIndex).not.toHaveBeenCalled();
    expect(console.log).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalled();
    expect((await loggingRag.search('authenticate', { mode: 'keyword' }))[0].filePath).toBe(chunk.filePath);
  });

  it('builds and reuses keyword indexes without downloading embeddings when FAISS is unavailable', async () => {
    mocks.nativeAvailable = false;
    vi.resetModules();
    const { RAGSystem: WithoutNative } = await import('../src/rag/index.js');
    const keywordRag = new WithoutNative({ storePath: store, repoPath: root });
    fs.writeFileSync(path.join(root, 'auth.ts'), chunk.content);
    await keywordRag.indexRepository();
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.pipeline).not.toHaveBeenCalled();
    const chunkSpy = vi.spyOn(keywordRag as any, 'chunkFile');
    await keywordRag.indexRepository();
    expect(chunkSpy).not.toHaveBeenCalled();
    expect((await keywordRag.search('authenticate', { mode: 'keyword' }))[0].filePath).toBe('auth.ts');
  });

  it('rebuilds an old cache from source instead of loading incompatible vectors', async () => {
    seedCache('Xenova/bge-small-en-v1.5', 384);
    fs.writeFileSync(path.join(root, 'auth.ts'), chunk.content);
    await rag.indexRepository();
    expect(mocks.readIndex).not.toHaveBeenCalled();
    expect(mocks.constructIndex).toHaveBeenCalledWith(768);
    expect(rag.getIndexState()?.embeddingModel).toBe(defaultModel);
    expect(rag.getIndexState()?.embeddingDimension).toBe(768);
  });

  it('honors forced rebuilding even for a compatible cache', async () => {
    seedCache();
    fs.writeFileSync(path.join(root, 'auth.ts'), chunk.content);
    await rag.indexRepository({ force: true });
    expect(mocks.readIndex).not.toHaveBeenCalled();
    expect(mocks.add).toHaveBeenCalled();
  });

  it('migrates metadata-only loads without requiring the original repository', async () => {
    seedCache('Xenova/bge-small-en-v1.5', 384);
    rag = new RAG({ storePath: store, repoPath: path.join(root, 'missing-repository') });
    await rag.loadMetadataOnly();
    expect(mocks.readIndex).not.toHaveBeenCalled();
    expect(mocks.constructIndex).toHaveBeenCalledWith(768);
    expect(rag.getIndexState()?.embeddingModel).toBe(defaultModel);
    expect(mocks.tokenize.mock.calls[0][0]).toContain(`title: ${chunk.filePath} | text:`);
    const state = JSON.parse(fs.readFileSync(path.join(store, 'index-state.json'), 'utf-8'));
    expect(state.embeddingDimension).toBe(768);
    expect(state.commitHash).toBe('old-commit');
  });

  it('rebuilds a corrupt cached dimension before metadata-only search', async () => {
    seedCache();
    mocks.readIndex.mockReturnValue({ getDimension: () => 384 });
    await rag.loadMetadataOnly();
    expect(mocks.constructIndex).toHaveBeenCalledWith(768);
    expect(rag.getIndexState()?.embeddingDimension).toBe(768);
  });

  it('does not overwrite a legacy cache when migration inference fails', async () => {
    seedCache('Xenova/bge-small-en-v1.5', 384);
    mocks.infer.mockRejectedValue(new Error('Inference failed'));
    await expect(rag.loadMetadataOnly()).rejects.toThrow('Failed to embed chunk');
    expect(fs.readFileSync(path.join(store, 'index.faiss'), 'utf-8')).toBe('cached index');
    const state = JSON.parse(fs.readFileSync(path.join(store, 'index-state.json'), 'utf-8'));
    expect(state.embeddingModel).toBe('Xenova/bge-small-en-v1.5');
    expect(mocks.add).not.toHaveBeenCalled();
  });

  it('re-embeds unchanged and changed chunks with the same model during incremental updates', async () => {
    seedCache('Xenova/bge-small-en-v1.5', 384);
    fs.writeFileSync(path.join(root, 'changed.ts'), 'export function changed() { return "this changed source file is long enough to index"; }');
    await rag.updateIndex(['changed.ts']);
    expect(mocks.constructIndex).toHaveBeenCalledWith(768);
    expect(mocks.tokenize.mock.calls.some(([text]) => text.includes('title: src/auth.ts | text:'))).toBe(true);
    expect(mocks.tokenize.mock.calls.some(([text]) => text.includes('title: changed.ts | text:'))).toBe(true);
    expect(rag.getIndexState()?.embeddingModel).toBe(defaultModel);
  });

  it('finalizes batches with the generated vector dimension for custom models', async () => {
    seedCache();
    rag = new RAG({ storePath: store, repoPath: root, embeddingModel: 'Xenova/custom-model' });
    await rag.finalizeIndex();
    expect(mocks.constructIndex).toHaveBeenCalledWith(384);
    expect(rag.getIndexState()?.embeddingDimension).toBe(384);
  });

  it('preserves enriched chunk metadata when indexing batches', async () => {
    rag['discoverFiles'] = async () => ['src/auth.ts'];
    rag['chunkFile'] = async () => [chunk];
    await rag.indexBatch(0, 10);
    const metadata = JSON.parse(fs.readFileSync(path.join(store, 'metadata.json'), 'utf-8'));
    expect(metadata[0].domainContext).toBe(chunk.domainContext);
    expect(metadata[0].documentation).toBe(chunk.documentation);
    await rag.finalizeIndex();
    expect(mocks.tokenize.mock.calls[0][0]).toBe(mocks.tokenize.mock.calls[1][0]);
    expect(mocks.constructIndex).toHaveBeenCalledWith(768);
  });
});
