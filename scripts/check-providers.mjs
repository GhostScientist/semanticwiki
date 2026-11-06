#!/usr/bin/env node
/** Opt-in live checks: synthetic content only; excluded from npm test. */
import { parseArgs } from 'node:util';
import dotenv from 'dotenv';
import {
  AnthropicProvider, OpenAIProvider, LocalLlamaProvider, ModelManager,
  DEFAULT_LOCAL_MODEL_ID, assistantMessageFromResponse,
} from '../dist/llm/index.js';

dotenv.config({ quiet: true });
const { values } = parseArgs({ options: {
  provider: { type: 'string' }, model: { type: 'string' },
  'model-path': { type: 'string' }, download: { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h' },
} });
const usage = `Usage: node scripts/check-providers.mjs --provider <openai|anthropic|local|all> [--model <id>] [--model-path <gguf>] [--download]

Runs tiny synthetic checks. Cloud checks spend a small amount of API credit.
Local checks reuse a prepared model; --download explicitly permits downloading it.
Build first with npm run build. No repository content is sent to a provider.`;
if (values.help || !values.provider) {
  console.log(usage);
  process.exit(values.help ? 0 : 1);
}
const providers = values.provider === 'all' ? ['openai', 'anthropic', 'local'] : [values.provider];
if (providers.some(provider => !['openai', 'anthropic', 'local'].includes(provider))) throw new Error(usage);
if (values.model && providers.length !== 1) throw new Error('--model requires a single --provider.');
const results = [];
for (const name of providers) {
  let provider;
  try {
    if (name === 'local') {
      let modelPath = values['model-path'];
      if (!modelPath) {
        const manager = new ModelManager();
        const model = manager.getModelById(values.model ?? DEFAULT_LOCAL_MODEL_ID);
        if (!model) throw new Error('Unknown local model. Run semanticwiki models list.');
        if (values.download) {
          let previous = -1;
          manager.setProgressCallback(progress => {
            const percent = Math.floor((progress.percent ?? 0) / 10) * 10;
            if (percent !== previous) { console.error(`Model download: ${percent}%`); previous = percent; }
          });
          modelPath = await manager.ensureModel(model);
        } else {
          if (!await manager.verifyModel(model)) throw new Error('Prepare the local model first with semanticwiki models prepare, or pass --download.');
          modelPath = manager.getModelPath(model.modelId);
        }
      }
      if (!modelPath) throw new Error('The prepared local model file is no longer available. Run semanticwiki models prepare.');
      provider = new LocalLlamaProvider({ modelPath, contextSize: 8192 });
      await provider.initialize();
      const outputs = [];
      for (let run = 0; run < 2; run++) {
        const response = await provider.chat([{ role: 'user', content: '<START_OF_CONTEXT>\nexport function add(a, b) { return a + b; }\n<END_OF_CONTEXT>\n\n<query>\nExplain this function in one sentence.\n</query>' }], [], { maxTokens: 96, temperature: 0 });
        if (!response.content.trim()) throw new Error('The local model returned no visible output.');
        outputs.push({ text: response.content, usage: response.usage });
      }
      results.push({ provider: name, model: provider.getModelInfo().name, status: 'passed', consecutiveCalls: outputs.length, outputs });
    } else {
      provider = name === 'openai' ? new OpenAIProvider({ model: values.model }) : new AnthropicProvider({ model: values.model });
      await provider.initialize();
      const tools = [{ name: 'lookup_fixture', description: 'Return a synthetic source fixture. Call this before answering.', parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } }];
      const messages = [{ role: 'user', content: 'Call lookup_fixture with id sample. Then explain what the returned function does in one short sentence. Do not answer before calling the tool.' }];
      const first = await provider.chat(messages, tools, { maxTokens: 2048 });
      if (!first.toolCalls.length) throw new Error(`The model did not call the test tool (${first.stopReason}).`);
      messages.push(assistantMessageFromResponse(first), { role: 'user', content: first.toolCalls.map(call => ({ type: 'tool_result', tool_use_id: call.id, content: 'Synthetic fixture only: function add(a, b) { return a + b; }' })) });
      const second = await provider.chat(messages, tools, { maxTokens: 2048 });
      if (!second.content.trim()) throw new Error('No visible answer after returning tool results.');
      results.push({ provider: name, model: provider.getModelInfo().name, status: 'passed', toolCalls: first.toolCalls.length, text: second.content, usage: [first.usage, second.usage] });
    }
  } catch (error) {
    results.push({ provider: name, status: 'failed', error: error.message });
  } finally { await provider?.shutdown(); }
}
for (const result of results) console.log(JSON.stringify(result));
if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
