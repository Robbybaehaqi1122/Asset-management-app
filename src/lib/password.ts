/**
 * Password sementara untuk akun yang dibuat admin.
 *
 * `crypto.getRandomValues` is the platform CSPRNG, the same one the browser
 * uses for key material. `Math.random` is not: it is seeded from a 32-bit state
 * and its output is predictable from a handful of observed values, which is
 * exactly the property a password must not have. No dependency, because
 * `crypto` is already in the platform and the repo's rule is to ask before
 * adding a package.
 */

/**
 * Lower case, upper case, digits and a symbol, with the visually ambiguous
 * characters removed: `0`/`O`, `1`/`l`/`I`. This is a password somebody has to
 * read out loud or type from a screen, and a misread `0` as `O` shows up later
 * as a support ticket rather than as a clever design.
 */
const ALPHABET_LOWER = "abcdefghijkmnopqrstuvwxyz";
const ALPHABET_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const ALPHABET_DIGIT = "23456789";
const ALPHABET_SYMBOL = "!@#$%^&*?-_";

const ALPHABET =
  ALPHABET_LOWER + ALPHABET_UPPER + ALPHABET_DIGIT + ALPHABET_SYMBOL;

/** 20 characters, about 125 bits of entropy at this alphabet's size. */
export const GENERATED_PASSWORD_LENGTH = 20;

function randomInt(maxExclusive: number): number {
  // `getRandomValues` is specified to fill a Uint32Array, so a single value is
  // uniform over the full 32-bit range and there is no modulo bias as long as
  // the bound divides it. All four alphabet sizes are small enough for the
  // rejection step below to terminate on the first try almost always.
  const range = 0x100000000;
  const limit = range - (range % maxExclusive);
  const buffer = new Uint32Array(1);
  let value = maxExclusive;
  while (value >= limit) {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  }
  return value % maxExclusive;
}

/**
 * Build one password that is guaranteed to contain at least one character from
 * each class.
 *
 * Without that, a 20-character draw can legitimately come up all letters, which
 * is rarer but real, and a password with no symbol is a password some
 * corporate policies reject. The guarantee is paid for by drawing one extra
 * character per class and shuffling, rather than by rejection sampling, so the
 * length is always exactly what it says.
 */
export function generatePassword(
  length: number = GENERATED_PASSWORD_LENGTH,
): string {
  const classes = [
    ALPHABET_LOWER,
    ALPHABET_UPPER,
    ALPHABET_DIGIT,
    ALPHABET_SYMBOL,
  ];

  const size = Math.max(length, classes.length);
  const characters: string[] = classes.map((set) => set[randomInt(set.length)]);

  while (characters.length < size) {
    characters.push(ALPHABET[randomInt(ALPHABET.length)]);
  }

  // Fisher-Yates, so the guaranteed characters do not sit in a predictable
  // position. `crypto` again, for the same reason as above.
  for (let i = characters.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [characters[i], characters[j]] = [characters[j], characters[i]];
  }

  return characters.join("");
}
