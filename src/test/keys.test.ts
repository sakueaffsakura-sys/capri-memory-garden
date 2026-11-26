import { describe, expect, it } from "vitest";
import { generateApiKey, keyPrefix, sha256Hex } from "@/lib/keys";

describe("chaves da Capri", () => {
  it("gera cap_ + 40 caracteres base62", () => {
    const k = generateApiKey();
    expect(k).toMatch(/^cap_[0-9A-Za-z]{40}$/);
  });
  it("prefixo tem os 12 primeiros caracteres", () => {
    expect(keyPrefix("cap_ABCDEFGHijklmnop")).toBe("cap_ABCDEFGH");
  });
  it("hash é sha-256 hex minúsculo de 64 caracteres", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
