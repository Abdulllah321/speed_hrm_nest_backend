/**
 * Generates the next sequential 3-character alphanumeric ID (0-9, a-z).
 * Sequence: 000, 001, ..., 009, 00a, ..., 00z, 010, ...
 *
 * @param existingIds List of existing 3-character IDs
 * @returns The next available sequential ID
 */
export function generateNextPosId(existingIds: string[]): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  const base = chars.length;

  if (existingIds.length === 0) {
    return '001'; // Start with 001 as 000 might be reserved or less desirable
  }

  // Convert IDs to numbers
  const idNumbers = existingIds
    .map((id) => {
      if (id.length !== 3) return -1;
      let val = 0;
      for (let i = 0; i < 3; i++) {
        const charIndex = chars.indexOf(id[i]);
        if (charIndex === -1) return -1;
        val += charIndex * Math.pow(base, 2 - i);
      }
      return val;
    })
    .filter((val) => val !== -1)
    .sort((a, b) => a - b);

  let nextVal = 1;
  for (const val of idNumbers) {
    if (val === nextVal) {
      nextVal++;
    } else if (val > nextVal) {
      break;
    }
  }

  if (nextVal >= Math.pow(base, 3)) {
    throw new Error('Maximum number of POS IDs reached for this location');
  }

  // Convert back to 3-char string
  let result = '';
  let temp = nextVal;
  for (let i = 0; i < 3; i++) {
    const remainder = temp % base;
    result = chars[remainder] + result;
    temp = Math.floor(temp / base);
  }

  return result;
}
