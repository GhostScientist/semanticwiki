import { modelProgressReporter } from './progress.js';
import { Command } from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getRuntimePaths } from './runtime-paths.js';
import { ConfigManager } from './config.js';
import { DEFAULT_LOCAL_MODEL_ID, DEFAULT_LOCAL_CONTEXT_SIZE, DEFAULT_ANTHROPIC_MODEL, DEFAULT_OPENAI_MODEL } from './llm/defaults.js';
import { exportKnowledgeBundle } from './knowledge-export.js';
import { compareReports, evaluateWiki, renderReportMarkdown, type EvalReport } from './eval/index.js';

export function registerManagementCommands(program: Command): void {
  program.command('doctor')
    .description('Inspect credentials, storage and model readiness without downloading anything')
    .option('--json', 'Print a machine-readable report')
    .action(async options => {
      const config = await new ConfigManager().load();
      const paths = getRuntimePaths();
      const { ModelManager } = await import('./llm/model-manager.js');
      const manager = new ModelManager();
      const model = manager.getModelById(DEFAULT_LOCAL_MODEL_ID)!;
      const report = {
        formatVersion: 1,
        node: process.version,
        paths,
        providers: {
          anthropic: { configured: Boolean(config.apiKey?.trim()), model: DEFAULT_ANTHROPIC_MODEL },
          openai: { configured: Boolean(config.openaiApiKey?.trim()), model: DEFAULT_OPENAI_MODEL },
          local: { downloaded: manager.isModelDownloaded(model.modelId), model: model.modelId, contextSize: DEFAULT_LOCAL_CONTEXT_SIZE, path: path.join(manager.getModelsDir(), model.ggufFile), downloadBytes: model.fileSizeBytes },
          ollama: { requires: 'A running Ollama server and an installed model' },
        },
        legacyPaths: ['.semanticwiki-models', '.semanticwiki-repos'].map(name => path.resolve(name)).filter(p => fs.existsSync(p)),
      };
      if (options.json) console.log(JSON.stringify(report, null, 2));
      else {
        console.log(`SemanticWiki · Node ${report.node}\n`);
        console.log(`Anthropic: ${report.providers.anthropic.configured ? 'key configured' : 'set ANTHROPIC_API_KEY'} (${DEFAULT_ANTHROPIC_MODEL})`);
        console.log(`OpenAI:    ${report.providers.openai.configured ? 'key configured' : 'set OPENAI_API_KEY'} (${DEFAULT_OPENAI_MODEL})`);
        console.log(`Local:     ${report.providers.local.downloaded ? 'model present (models verify checks integrity)' : 'run semanticwiki models prepare'} (${model.modelId})`);
        console.log(`\nStorage: ${paths.homeDir}\nWeights: ${paths.modelsDir}\nEmbedding downloads: ${paths.embeddingsDir}\nRepository cache: ${paths.reposDir}`);
        console.log('Wiki indexes stay in <wiki>/.semanticwiki-cache for portability.');
        for (const legacy of report.legacyPaths) console.log(`Legacy directory left untouched: ${legacy}`);
      }
    });

  program.command('eval [wiki]')
    .description('Score a wiki on verifiable citations, structure, diagrams and links; compare two reports')
    .option('-r, --repo <dir>', 'Repository the wiki documents (default: recorded in .semanticwiki-run.json)')
    .option('--json', 'Print the full machine-readable report')
    .option('--out <file>', 'Write the JSON report to this file (default: <wiki>/.semanticwiki-eval.json)')
    .option('--no-write', 'Do not write a report file')
    .option('--min-reward <n>', 'Exit 1 when the mean page reward is below this threshold', parseFloat)
    .option('--min-validity <n>', 'Exit 1 when citation validity is below this threshold', parseFloat)
    .option('--compare <reports...>', 'Compare two JSON reports (A B): paired deltas of B minus A')
    .action(async (wikiArg: string | undefined, options) => {
      if (options.compare) {
        if (options.compare.length !== 2) { console.error('eval --compare needs exactly two report files.'); process.exit(2); }
        const [a, b] = options.compare.map((file: string) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')) as EvalReport);
        if (a.formatVersion !== 1 || b.formatVersion !== 1) { console.error('Both reports must be formatVersion 1 eval reports.'); process.exit(2); }
        const comparison = compareReports(a, b);
        if (options.json) { console.log(JSON.stringify(comparison, null, 2)); return; }
        console.log(`Paired comparison over ${comparison.cells} shared pages (B minus A)\n`);
        console.log('| Metric | Delta | 95% CI | p |\n| --- | ---: | --- | ---: |');
        for (const delta of comparison.deltas) console.log(`| ${delta.metric} | ${delta.delta > 0 ? '+' : ''}${delta.delta} | [${delta.ci95[0]}, ${delta.ci95[1]}] | ${delta.pTwoSided} |`);
        if (comparison.onlyInA.length || comparison.onlyInB.length) console.log(`\nUnpaired pages: only in A ${comparison.onlyInA.length}, only in B ${comparison.onlyInB.length}`);
        return;
      }
      const wikiDir = path.resolve(wikiArg || './wiki');
      if (!fs.existsSync(wikiDir)) { console.error(`Wiki directory not found: ${wikiDir}`); process.exit(2); }
      let repo: string | undefined = options.repo ? path.resolve(options.repo) : undefined;
      if (!repo) {
        try {
          const run = JSON.parse(fs.readFileSync(path.join(wikiDir, '.semanticwiki-run.json'), 'utf8'));
          if (run.formatVersion === 1 && typeof run.sourcePath === 'string' && path.isAbsolute(run.sourcePath)) repo = run.sourcePath;
        } catch { /* no run manifest */ }
      }
      if (!repo || !fs.existsSync(repo)) { console.error('Pass --repo <dir>: the repository is needed to verify citations.'); process.exit(2); }
      const report = evaluateWiki(wikiDir, repo);
      if (options.write !== false) {
        const out = path.resolve(options.out || path.join(wikiDir, '.semanticwiki-eval.json'));
        fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
      }
      const failures: string[] = [];
      if (Number.isFinite(options.minReward) && report.summary.meanReward < options.minReward) failures.push(`mean reward ${report.summary.meanReward} < ${options.minReward}`);
      if (Number.isFinite(options.minValidity) && report.summary.citations.validity < options.minValidity) failures.push(`citation validity ${report.summary.citations.validity} < ${options.minValidity}`);
      if (options.json) console.log(JSON.stringify({ ...report, thresholds: { passed: failures.length === 0, failures } }, null, 2));
      else {
        console.log(renderReportMarkdown(report));
        for (const failure of failures) console.error(`Threshold failed: ${failure}`);
      }
      if (failures.length) process.exit(1);
    });

  const models = program.command('models').description('List, prepare and verify shared local models');
  models.command('list').description('Show supported models and their local paths')
    .option('--json', 'Print machine-readable model information')
    .action(async options => {
      const { ModelManager } = await import('./llm/model-manager.js');
      const manager = new ModelManager();
      const records = manager.getAvailableModels().map(model => ({ ...model, path: path.join(manager.getModelsDir(), model.ggufFile), downloaded: manager.isModelDownloaded(model.modelId) }));
      if (options.json) console.log(JSON.stringify(records, null, 2));
      else for (const model of records) console.log(`${model.modelId}  ${(model.fileSizeBytes / 1e9).toFixed(2)} GB  ${model.downloaded ? 'present' : 'not downloaded'}\n  ${model.path}`);
    });
  models.command('prepare [model]').description('Download and integrity-check a GGUF model into shared storage')
    .action(async (id = DEFAULT_LOCAL_MODEL_ID) => {
      const { ModelManager } = await import('./llm/model-manager.js');
      const manager = new ModelManager();
      const model = manager.getModelById(id);
      if (!model) throw new Error(`Unknown model: ${id}. Run semanticwiki models list.`);
      manager.setProgressCallback(modelProgressReporter());
      console.error(`Preparing ${model.modelId} (${(model.fileSizeBytes / 1e9).toFixed(2)} GB) at ${path.join(manager.getModelsDir(), model.ggufFile)}`);
      console.log(await manager.ensureModel(model));
    });
  models.command('verify [model]').description('Verify a cached model without downloading')
    .action(async (id = DEFAULT_LOCAL_MODEL_ID) => {
      const { ModelManager } = await import('./llm/model-manager.js');
      const manager = new ModelManager();
      if (!manager.getModelById(id)) throw new Error(`Unknown model: ${id}. Run semanticwiki models list.`);
      if (!await manager.verifyModel(id)) throw new Error(`Model missing or integrity check failed. Run semanticwiki models prepare ${id}.`);
      console.log(`Verified ${id}`);
    });

  program.command('export').description('Export an existing wiki for agents using Open Knowledge Format 0.2')
    .option('-o, --output <dir>', 'Wiki directory', './wiki')
    .option('-r, --repo <path>', 'Source repository for revision metadata')
    .option('--title <title>', 'Knowledge catalog title')
    .option('--json', 'Print machine-readable export metadata')
    .action(async options => {
      const result = await exportKnowledgeBundle({ wikiDir: path.resolve(options.output), title: options.title, repoPath: options.repo });
      console.log(options.json ? JSON.stringify(result, null, 2) : `Exported ${result.pageCount} pages to ${result.bundlePath}`);
    });
}
