import { HttpError } from "./errors";

function decodeBase64(b64: string): Uint8Array {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    throw new HttpError(
      500,
      "bad_encryption_key",
      "ENCRYPTION_KEY_B64 must be base64 of 32 bytes (AES-256), optionally as a comma-separated list for rotation"
    );
  }
}

function encodeBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function parseEncryptionKeyList(encryptionKeyB64: string): string[] {
  const keys = (encryptionKeyB64 ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (keys.length === 0) {
    throw new HttpError(500, "missing_config", "ENCRYPTION_KEY_B64 is not set");
  }

  return keys;
}

async function importAesKey(encryptionKeyB64: string): Promise<CryptoKey> {
  const raw = decodeBase64(encryptionKeyB64);
  if (raw.byteLength !== 32) {
    throw new HttpError(
      500,
      "bad_encryption_key",
      "ENCRYPTION_KEY_B64 must be base64 of 32 bytes (AES-256), optionally as a comma-separated list for rotation"
    );
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptString(plaintext: string, encryptionKeyB64: string) {
  const [primaryKeyB64] = parseEncryptionKeyList(encryptionKeyB64);
  const key = await importAesKey(primaryKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, encoded);
  return {
    ciphertextB64: encodeBase64(new Uint8Array(ciphertext)),
    ivB64: encodeBase64(iv)
  };
}

export async function decryptString(ciphertextB64: string, ivB64: string, encryptionKeyB64: string) {
  const keys = parseEncryptionKeyList(encryptionKeyB64);
  const ciphertext = decodeBase64(ciphertextB64);
  const iv = decodeBase64(ivB64);

  let lastError: unknown = null;
  for (const keyB64 of keys) {
    const key = await importAesKey(keyB64);
    try {
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
      return new TextDecoder().decode(plaintext);
    } catch (err) {
      lastError = err;
    }
  }

  const message =
    keys.length > 1
      ? "Stored secret cannot be decrypted with any configured ENCRYPTION_KEY_B64 entries"
      : "Stored secret cannot be decrypted with ENCRYPTION_KEY_B64";

  const hint = "If you rotated the key, include previous key(s) as a comma-separated list, or recreate the connector.";

  throw new HttpError(
    500,
    "decryption_failed",
    lastError instanceof Error ? `${message}. ${hint} (${lastError.message})` : `${message}. ${hint}`
  );
}
