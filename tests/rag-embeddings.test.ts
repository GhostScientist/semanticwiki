import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Tensor } from '@huggingface/transformers';
import type { CodeChunk, RAGSystem } from '../src/rag/index.js';

const mocks = vi.hoisted(() => ({
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
  createRequire: () => () => ({
    IndexFlatIP: Object.assign(class {
      constructor(private dimension: number) {
        mocks.constructIndex(dimension);
      }
      getDimension() { return this.dimension; }
      add(vectors: number[]) { mocks.add(vectors); }
      write(file: string) { mocks.write(file); }
      search(vector: number[], count: number) { return mocks.search(vector, count); }
    }, { read: mocks.readIndex })
  })
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
    seedCache();
    await rag.indexRepository();
    expect(mocks.readIndex).toHaveBeenCalledTimes(1);
    expect(mocks.model).not.toHaveBeenCalled();
    const results = await rag.search('authenticate', { mode: 'vector' });
    expect(results[0].filePath).toBe(chunk.filePath);
    expect(mocks.search.mock.calls[0][0]).toHaveLength(768);
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
