import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Project root; works from both `src/` and the compiled `dist/`. */
export const projectRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
);

export interface SplitserConfig {
  cookieFile: string;
  baseUrl: string;
  apiVersion: string;
  timeoutMs: number;
  listTtlMs: number;
  transactionTtlMs: number;
  email: string | undefined;
  password: string | undefined;
}

export async function loadEnv(directory: string): Promise<void> {
  let contents: string;
  try {
    contents = await readFile(resolve(directory, '.env'), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)?\s*$/);
    const key = match?.[1];
    if (!key || process.env[key] !== undefined) continue;
    let value = match[2] || '';
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    )
      value = value.slice(1, -1);
    process.env[key] = value;
  }
}

export function splitserConfig(directory: string): SplitserConfig {
  const integer = (name: string, fallback: number) =>
    Number(process.env[name] || fallback);
  return {
    cookieFile: resolve(directory, process.env.COOKIE_FILE || './cookies.txt'),
    baseUrl: process.env.SPLITSER_BASE_URL || 'https://app.splitser.com',
    apiVersion: process.env.SPLITSER_API_VERSION || '11',
    timeoutMs: integer('REQUEST_TIMEOUT_MS', 30000),
    listTtlMs: integer('LIST_CACHE_TTL_MS', 60000),
    transactionTtlMs: integer('TRANSACTION_CACHE_TTL_MS', 300000),
    email: process.env.SPLITSER_EMAIL,
    password: process.env.SPLITSER_PASSWORD,
  };
}
