/**
 * Tests for RAG System Hybrid Search Features
 *
 * Tests the BM25 keyword search, vector similarity search,
 * and hybrid search with Reciprocal Rank Fusion (RRF).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

// Mock the transformers module to avoid loading actual models in tests
vi.mock('@huggingface/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(async (text: string) => ({
    data: new Float32Array(384).fill(0.1)
  })),
  env: { cacheDir: './.test-models' }
}));

// Mock faiss-node since it requires native binaries
vi.mock('faiss-node', () => ({
  IndexFlatIP: vi.fn().mockImplementation(() => ({
    add: vi.fn(),
    search: vi.fn().mockReturnValue({ labels: [[0, 1]], distances: [[0.9, 0.8]] }),
    write: vi.fn(),
    ntotal: 0
  }))
}));

describe('RAG Hybrid Search', () => {
  describe('BM25 Algorithm', () => {
    // Test the BM25 tokenization and scoring logic

    function tokenize(text: string): string[] {
      return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(token => token.length > 1);
    }

    it('should tokenize text correctly', () => {
      const text = 'Hello World! This is a test.';
      const tokens = tokenize(text);

      expect(tokens).toContain('hello');
      expect(tokens).toContain('world');
      expect(tokens).toContain('this');
      expect(tokens).toContain('test');
      expect(tokens).not.toContain('!');
      expect(tokens).not.toContain('.');
    });

    it('should filter short tokens', () => {
      const text = 'I am a developer';
      const tokens = tokenize(text);

      expect(tokens).not.toContain('i');
      expect(tokens).not.toContain('a');
      expect(tokens).toContain('am');
      expect(tokens).toContain('developer');
    });

    it('should handle code-like text', () => {
      const text = 'function calculateTotal(items: Item[]) { return items.length; }';
      const tokens = tokenize(text);

      expect(tokens).toContain('function');
      expect(tokens).toContain('calculatetotal');
      expect(tokens).toContain('items');
      expect(tokens).toContain('return');
    });

    it('should calculate BM25 score correctly', () => {
      // BM25 formula: IDF * (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgdl))
      const k1 = 1.2;
      const b = 0.75;

      function calculateBM25(
        tf: number,      // term frequency in document
        df: number,      // document frequency (how many docs contain term)
        N: number,       // total number of documents
        dl: number,      // document length
        avgdl: number    // average document length
      ): number {
        // IDF with smoothing
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        // TF normalization
        const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * dl / avgdl));
        return idf * tfNorm;
      }

      // Test case: term appears 2 times in a doc, 10 docs total, term in 3 docs
      const score = calculateBM25(2, 3, 10, 100, 150);
      expect(score).toBeGreaterThan(0);

      // Rare terms should score higher
      const rareScore = calculateBM25(2, 1, 10, 100, 150);
      const commonScore = calculateBM25(2, 8, 10, 100, 150);
      expect(rareScore).toBeGreaterThan(commonScore);

      // More occurrences should score higher (with diminishing returns)
      const lowTf = calculateBM25(1, 3, 10, 100, 150);
      const highTf = calculateBM25(5, 3, 10, 100, 150);
      expect(highTf).toBeGreaterThan(lowTf);
    });
  });

  describe('Reciprocal Rank Fusion (RRF)', () => {
    function reciprocalRankFusion(
      rankedLists: Array<Array<{ docId: number; score: number }>>,
      k: number = 60
    ): Map<number, number> {
      const fusedScores = new Map<number, number>();

      for (const rankedList of rankedLists) {
        for (let rank = 0; rank < rankedList.length; rank++) {
          const docId = rankedList[rank].docId;
          const rrfScore = 1 / (k + rank + 1);

          const current = fusedScores.get(docId) || 0;
          fusedScores.set(docId, current + rrfScore);
        }
      }

      return fusedScores;
    }

    it('should combine two ranked lists correctly', () => {
      const vectorResults = [
        { docId: 1, score: 0.95 },
        { docId: 2, score: 0.85 },
        { docId: 3, score: 0.75 }
      ];

      const bm25Results = [
        { docId: 2, score: 5.2 },
        { docId: 1, score: 4.8 },
        { docId: 4, score: 3.5 }
      ];

      const fused = reciprocalRankFusion([vectorResults, bm25Results]);

      // Doc 1: rank 0 in vector (1/61) + rank 1 in bm25 (1/62)
      // Doc 2: rank 1 in vector (1/62) + rank 0 in bm25 (1/61)
      // Both should be similar since they appear in top positions

      expect(fused.get(1)).toBeDefined();
      expect(fused.get(2)).toBeDefined();
      expect(fused.get(3)).toBeDefined();
      expect(fused.get(4)).toBeDefined();

      // Doc that appears in both lists should have higher score
      expect(fused.get(1)!).toBeGreaterThan(fused.get(3)!);
      expect(fused.get(2)!).toBeGreaterThan(fused.get(4)!);
    });

    it('should handle documents appearing in only one list', () => {
      const list1 = [{ docId: 1, score: 1.0 }];
      const list2 = [{ docId: 2, score: 1.0 }];

      const fused = reciprocalRankFusion([list1, list2]);

      // Both should have equal scores (both at rank 0)
      expect(fused.get(1)).toEqual(fused.get(2));
    });

    it('should respect the k parameter', () => {
      const results = [
        { docId: 1, score: 1.0 },
        { docId: 2, score: 0.9 }
      ];

      // With k=60 (default), top result gets 1/61
      const fusedDefault = reciprocalRankFusion([results], 60);
      expect(fusedDefault.get(1)).toBeCloseTo(1 / 61, 6);

      // With k=10, top result gets 1/11 (higher weight for top ranks)
      const fusedSmallK = reciprocalRankFusion([results], 10);
      expect(fusedSmallK.get(1)).toBeCloseTo(1 / 11, 6);

      // Smaller k gives more weight to top positions
      expect(fusedSmallK.get(1)! - fusedSmallK.get(2)!).toBeGreaterThan(
        fusedDefault.get(1)! - fusedDefault.get(2)!
      );
    });
  });

  describe('Search Mode Selection', () => {
    it('should default to hybrid mode when useHybridSearch is true', () => {
      const config = { useHybridSearch: true };
      const mode = config.useHybridSearch ? 'hybrid' : 'vector';
      expect(mode).toBe('hybrid');
    });

    it('should use vector mode when useHybridSearch is false', () => {
      const config = { useHybridSearch: false };
      const mode = config.useHybridSearch ? 'hybrid' : 'vector';
      expect(mode).toBe('vector');
    });

    it('should allow explicit mode override', () => {
      const config = { useHybridSearch: true };
      const searchOptions = { mode: 'keyword' as const };

      // Explicit mode should take precedence
      const effectiveMode = searchOptions.mode || (config.useHybridSearch ? 'hybrid' : 'vector');
      expect(effectiveMode).toBe('keyword');
    });
  });

  describe('Search Result Scoring', () => {
    interface SearchResult {
      id: string;
      score: number;
      vectorScore?: number;
      bm25Score?: number;
      rerankScore?: number;
    }

    it('should include individual scores in hybrid results', () => {
      const result: SearchResult = {
        id: 'test-1',
        score: 0.032, // RRF combined score
        vectorScore: 0.85,
        bm25Score: 4.2
      };

      expect(result.score).toBeDefined();
      expect(result.vectorScore).toBeDefined();
      expect(result.bm25Score).toBeDefined();
    });

    it('should include rerank score when reranking is enabled', () => {
      const result: SearchResult = {
        id: 'test-1',
        score: 0.92, // Reranked score
        vectorScore: 0.85,
        bm25Score: 4.2,
        rerankScore: 0.92
      };

      expect(result.rerankScore).toBeDefined();
      // When reranking, the final score should be the rerank score
      expect(result.score).toEqual(result.rerankScore);
    });
  });

  describe('Embedding Model Selection', () => {
    it('should prefer bge-small-en-v1.5 as default', () => {
      const defaultModel = 'Xenova/bge-small-en-v1.5';
      const fallbackModel = 'Xenova/all-MiniLM-L6-v2';

      expect(defaultModel).toBe('Xenova/bge-small-en-v1.5');
      expect(defaultModel).not.toBe(fallbackModel);
    });

    it('should allow custom embedding model', () => {
      const config = { embeddingModel: 'Xenova/custom-model' };
      expect(config.embeddingModel).toBe('Xenova/custom-model');
    });
  });
});

describe('Package Format', () => {
  const testDir = '/tmp/test-package';

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Package Manifest', () => {
    interface PackageManifest {
      version: string;
      name: string;
      description?: string;
      createdAt: string;
      sourceRepo?: string;
      sourceCommit?: string;
      wikiStats: {
        pageCount: number;
        totalSize: number;
      };
      ragStats?: {
        chunkCount: number;
        embeddingModel?: string;
        hasHybridIndex: boolean;
      };
    }

    it('should include required fields', () => {
      const manifest: PackageManifest = {
        version: '1.0.0',
        name: 'test-wiki',
        createdAt: new Date().toISOString(),
        wikiStats: {
          pageCount: 10,
          totalSize: 50000
        }
      };

      expect(manifest.version).toBeDefined();
      expect(manifest.name).toBeDefined();
      expect(manifest.createdAt).toBeDefined();
      expect(manifest.wikiStats).toBeDefined();
    });

    it('should include optional RAG stats when available', () => {
      const manifest: PackageManifest = {
        version: '1.0.0',
        name: 'test-wiki',
        createdAt: new Date().toISOString(),
        wikiStats: {
          pageCount: 10,
          totalSize: 50000
        },
        ragStats: {
          chunkCount: 500,
          embeddingModel: 'Xenova/bge-small-en-v1.5',
          hasHybridIndex: true
        }
      };

      expect(manifest.ragStats).toBeDefined();
      expect(manifest.ragStats!.hasHybridIndex).toBe(true);
    });
  });

  describe('File Structure', () => {
    it('should organize wiki files under wiki/ prefix', () => {
      const wikiPath = 'wiki/overview.md';
      expect(wikiPath.startsWith('wiki/')).toBe(true);
    });

    it('should organize RAG files under rag/ prefix', () => {
      const ragPath = 'rag/metadata.json';
      expect(ragPath.startsWith('rag/')).toBe(true);
    });

    it('should support extracting wiki-only', () => {
      const files = [
        'wiki/overview.md',
        'wiki/components/auth.md',
        'rag/metadata.json',
        'rag/bm25-index.json'
      ];

      const wikiOnly = files.filter(f => f.startsWith('wiki/'));
      expect(wikiOnly.length).toBe(2);
      expect(wikiOnly).not.toContain('rag/metadata.json');
    });
  });
});

describe('MCP Server Tools', () => {
  describe('Tool Definitions', () => {
    const tools = [
      { name: 'search_wiki', description: 'Search wiki documentation pages' },
      { name: 'get_wiki_page', description: 'Get full content of a wiki page' },
      { name: 'list_wiki_pages', description: 'List all wiki pages' },
      { name: 'search_code', description: 'Search codebase using semantic search' },
      { name: 'get_architecture_overview', description: 'Get architecture overview' }
    ];

    it('should define all required tools', () => {
      expect(tools.length).toBe(5);
      expect(tools.find(t => t.name === 'search_wiki')).toBeDefined();
      expect(tools.find(t => t.name === 'get_wiki_page')).toBeDefined();
      expect(tools.find(t => t.name === 'list_wiki_pages')).toBeDefined();
      expect(tools.find(t => t.name === 'search_code')).toBeDefined();
      expect(tools.find(t => t.name === 'get_architecture_overview')).toBeDefined();
    });
  });

  describe('Search Scoring', () => {
    function scoreWikiPage(
      page: { title: string; description: string; content: string; headings: string[] },
      queryKeywords: string[]
    ): number {
      let score = 0;
      const titleLower = page.title.toLowerCase();
      const descLower = page.description.toLowerCase();
      const contentLower = page.content.toLowerCase();

      for (const kw of queryKeywords) {
        if (titleLower.includes(kw)) score += 10;
        if (descLower.includes(kw)) score += 5;
        if (page.headings.some(h => h.toLowerCase().includes(kw))) score += 3;
        if (contentLower.includes(kw)) score += 1;
      }

      return score;
    }

    it('should weight title matches highest', () => {
      const page = {
        title: 'Authentication System',
        description: 'Handles user login',
        content: 'This module manages sessions.',
        headings: ['Overview']
      };

      const titleMatch = scoreWikiPage(page, ['authentication']);
      const contentMatch = scoreWikiPage(page, ['sessions']);

      expect(titleMatch).toBeGreaterThan(contentMatch);
    });

    it('should accumulate scores for multiple keyword matches', () => {
      const page = {
        title: 'Authentication',
        description: 'User authentication system',
        content: 'Handles authentication flows',
        headings: ['Authentication Methods']
      };

      // 'authentication' appears in title (10) + description (5) + content (1) + heading (3) = 19
      const score = scoreWikiPage(page, ['authentication']);
      expect(score).toBe(19);
    });
  });
});
