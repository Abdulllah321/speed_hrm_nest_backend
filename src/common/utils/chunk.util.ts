/**
 * Splits an array into chunks of a specified size to avoid parameter limit errors in database queries.
 */
export function chunkArray<T>(array: T[], size = 1000): T[][] {
  if (!array || array.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}
