#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");

const PROFILES = {
  "localapp-auth": {
    description: "Generate the RSA key pair used by localapp to decrypt secure commands.",
    outputDir: path.join(ROOT_DIR, "localapp", "keys"),
    privateFile: "auth_private.pem",
    publicFile: "auth_public.pem",
    passphraseEnv: "AUTH_PRIVATE_KEY_PASSPHRASE",
  },
  "webserver-sign": {
    description: "Generate the RSA key pair used by webserver to sign secure commands.",
    outputDir: path.join(ROOT_DIR, "webserver", "server", "keys"),
    privateFile: "webserver_sign_private.pem",
    publicFile: "webserver_sign_public.pem",
    passphraseEnv: "WEBSERVER_SIGN_PRIVATE_KEY_PASSPHRASE",
    mirrorPublicFiles: [path.join(ROOT_DIR, "localapp", "keys", "webserver_sign_public.pem")],
  },
};

function printUsage() {
  console.log("Usage:");
  console.log("  node scripts/generate-rsa-keypair.js <profile> [--force]");
  console.log("");
  console.log("Profiles:");
  for (const [name, profile] of Object.entries(PROFILES)) {
    console.log(`  ${name}  ${profile.description}`);
  }
}

function toRepoRelative(filePath) {
  return path.relative(ROOT_DIR, filePath).split(path.sep).join("/");
}

function getFingerprint(publicKey) {
  return crypto.createHash("sha256").update(publicKey).digest("hex");
}

function main() {
  const args = process.argv.slice(2);
  const profileName = args[0];

  if (!profileName || profileName === "--help" || profileName === "-h") {
    printUsage();
    process.exit(profileName ? 0 : 1);
  }

  const profile = PROFILES[profileName];
  if (!profile) {
    console.error(`Unknown profile: ${profileName}`);
    printUsage();
    process.exit(1);
  }

  const force = args.includes("--force");
  const outputDir = profile.outputDir;
  const privateKeyPath = path.join(outputDir, profile.privateFile);
  const publicKeyPath = path.join(outputDir, profile.publicFile);
  const mirrorPublicFiles = profile.mirrorPublicFiles || [];

  if (!force) {
    const existingFiles = [privateKeyPath, publicKeyPath, ...mirrorPublicFiles].filter((filePath) => fs.existsSync(filePath));
    if (existingFiles.length > 0) {
      console.error(`Refusing to overwrite existing files for profile "${profileName}".`);
      for (const filePath of existingFiles) {
        console.error(`- ${toRepoRelative(filePath)}`);
      }
      console.error('Re-run with "--force" if you really want to replace them.');
      process.exit(1);
    }
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const passphrase = process.env[profile.passphraseEnv] || "";
  const privateKeyEncoding = passphrase
    ? {
        type: "pkcs8",
        format: "pem",
        cipher: "aes-256-cbc",
        passphrase,
      }
    : {
        type: "pkcs8",
        format: "pem",
      };

  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding,
  });

  fs.writeFileSync(privateKeyPath, privateKey, "utf8");
  fs.writeFileSync(publicKeyPath, publicKey, "utf8");
  for (const filePath of mirrorPublicFiles) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, publicKey, "utf8");
  }

  const fingerprint = getFingerprint(publicKey);

  console.log(`Profile: ${profileName}`);
  console.log(`Description: ${profile.description}`);
  console.log(`Private key: ${toRepoRelative(privateKeyPath)}`);
  console.log(`Public key: ${toRepoRelative(publicKeyPath)}`);
  for (const filePath of mirrorPublicFiles) {
    console.log(`Public key copy: ${toRepoRelative(filePath)}`);
  }
  console.log(`Passphrase env: ${profile.passphraseEnv}`);
  console.log(`Passphrase applied: ${passphrase ? "yes" : "no"}`);
  console.log(`SHA-256 fingerprint: ${fingerprint}`);
  console.log("");
  console.log("Public key PEM:");
  console.log(publicKey.trim());
}

main();
