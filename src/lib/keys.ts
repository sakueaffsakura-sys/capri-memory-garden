const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** `cap_` + 40 random base62 chars (rejection sampling, no modulo bias). */
export function generateApiKey(): string {
  let out = "";
  while (out.length < 40) {
    const buf = new Uint8Array(64);
    crypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < 248 && out.length < 40) out += BASE62[b % 62];
    }
  }
  return "cap_" + out;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function keyPrefix(key: string): string {
  return key.slice(0, 12);
}
