import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function loadEnv(directory) {
  let contents;
  try {
    contents = await readFile(resolve(directory, '.env'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)?\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2] || '';
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}

export function splitserConfig(directory) {
  const integer = (name, fallback) => Number(process.env[name] || fallback);
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
