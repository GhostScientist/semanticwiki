import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { getRuntimePaths } from './runtime-paths.js';

export interface Config {
  apiKey?: string;
  openaiApiKey?: string;
  verbose?: boolean;
}

export class ConfigManager {
  private config: Config = {};

  async load(): Promise<Config> {
    try {
      const configData = await readFile(join(getRuntimePaths().homeDir, 'config.json'), 'utf-8');
      this.config = JSON.parse(configData);
    } catch (error) {
      this.config = {};
    }

    if (process.env.OPENAI_API_KEY) this.config.openaiApiKey = process.env.OPENAI_API_KEY;

    // Override with environment variables (ANTHROPIC_API_KEY is standard, CLAUDE_API_KEY for backward compat)
    if (process.env.ANTHROPIC_API_KEY) {
      this.config.apiKey = process.env.ANTHROPIC_API_KEY;
    } else if (process.env.CLAUDE_API_KEY) {
      this.config.apiKey = process.env.CLAUDE_API_KEY;
    }

    return this.config;
  }

  async save(config: Partial<Config>): Promise<void> {
    this.config = { ...this.config, ...config };
    
    try {
      const configDir = getRuntimePaths().homeDir;
      await mkdir(configDir, { recursive: true });
      await writeFile(join(configDir, 'config.json'), JSON.stringify(this.config, null, 2), { mode: 0o600 });
    } catch (error) {
      throw new Error(`Failed to save configuration: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  get(): Config {
    return { ...this.config };
  }

  getApiKey(): string | undefined {
    return this.config.apiKey;
  }

  hasApiKey(): boolean {
    return !!this.config.apiKey;
  }
}
