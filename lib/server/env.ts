import 'server-only';

export type EnvValue = string | undefined;

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function readEnv(name: string): EnvValue {
  const raw = process.env[name];
  if (typeof raw !== 'string') {
    return undefined;
  }
  const value = raw.trim();
  return value.length > 0 ? value : undefined;
}

export function readBooleanEnv(name: string): boolean | undefined {
  const value = readEnv(name);
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  return undefined;
}

export class MissingEnvironmentVariableError extends Error {
  constructor(public readonly variables: string[]) {
    super(`Missing environment variables: ${variables.join(', ')}`);
    this.name = 'MissingEnvironmentVariableError';
  }
}

export function requireEnv(names: string | string[]): Record<string, string> {
  const list = Array.isArray(names) ? names : [names];
  const missing: string[] = [];
  const resolved: Record<string, string> = {};

  for (const name of list) {
    const value = readEnv(name);
    if (!value) {
      missing.push(name);
      continue;
    }
    resolved[name] = value;
  }

  if (missing.length > 0) {
    throw new MissingEnvironmentVariableError(missing);
  }

  return resolved;
}
