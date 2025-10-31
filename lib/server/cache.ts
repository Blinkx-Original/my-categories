import 'server-only';

import { revalidatePath } from 'next/cache';

async function safeRevalidate(path: string) {
  try {
    await Promise.resolve(revalidatePath(path));
  } catch (error) {
    console.warn('revalidate_path_failed', { path, error: (error as Error)?.message });
  }
}

export async function revalidateProductPaths(slug: string, categories: Iterable<string | null | undefined>) {
  await safeRevalidate(`/p/${slug}`);
  const uniqueCategories = new Set<string>();
  for (const category of categories) {
    if (category) {
      uniqueCategories.add(category);
    }
  }
  await Promise.all(Array.from(uniqueCategories, (category) => safeRevalidate(`/c/${category}`)));
}

export async function revalidateBlogPaths(slug: string, categories: Iterable<string | null | undefined>) {
  await safeRevalidate(`/b/${slug}`);
  const uniqueCategories = new Set<string>();
  for (const category of categories) {
    if (category) {
      uniqueCategories.add(category);
    }
  }
  await Promise.all(Array.from(uniqueCategories, (category) => safeRevalidate(`/bc/${category}`)));
}
