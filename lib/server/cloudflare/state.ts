import 'server-only';

interface CloudflarePurgeBatch {
  urls: string[];
  createdAt: number;
}

let lastBatch: CloudflarePurgeBatch | null = null;

export function recordCloudflarePurgeBatch(urls: string[]) {
  lastBatch = {
    urls: Array.from(new Set(urls)),
    createdAt: Date.now(),
  };
}

export function getLastCloudflarePurgeBatch(): CloudflarePurgeBatch | null {
  return lastBatch;
}
