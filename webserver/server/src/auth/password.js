import crypto from "node:crypto";

const HASH_ALGORITHM = "sha256";
const HASH_ITERATIONS = 120000;
const HASH_KEY_LENGTH = 32;
const SALT_LENGTH = 16;

export function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LENGTH).toString("hex");
  const digest = deriveDigest(password, salt);

  return [
    HASH_ALGORITHM,
    String(HASH_ITERATIONS),
    salt,
    digest
  ].join("$");
}

export function verifyPassword(password, storedHash) {
  if (!storedHash) {
    return false;
  }

  const [algorithm, iterationsText, salt, digest] = storedHash.split("$");
  const iterations = Number(iterationsText);

  if (
    algorithm !== HASH_ALGORITHM ||
    !Number.isFinite(iterations) ||
    !salt ||
    !digest
  ) {
    return false;
  }

  const candidate = crypto.pbkdf2Sync(
    password,
    salt,
    iterations,
    HASH_KEY_LENGTH,
    algorithm
  );

  return crypto.timingSafeEqual(candidate, Buffer.from(digest, "hex"));
}

function deriveDigest(password, salt) {
  return crypto
    .pbkdf2Sync(password, salt, HASH_ITERATIONS, HASH_KEY_LENGTH, HASH_ALGORITHM)
    .toString("hex");
}

