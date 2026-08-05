import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { PAR_REMOTE_FETCH_MAX_BYTES, ParIntakeError } from "@/lib/cpdp/par-intake-server";

const MAX_REDIRECTS = 3;
const DEFAULT_ALLOWED_HOST_SUFFIXES = ["lexisnexis.com", "lexisnexisrisk.com"];

function allowedHostSuffixes() {
  return [
    ...DEFAULT_ALLOWED_HOST_SUFFIXES,
    ...(process.env.LEXISNEXIS_DOCUMENT_HOSTS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  ];
}

function isAllowedHost(hostname: string) {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  return allowedHostSuffixes().some(
    (suffix) => lower === suffix || lower.endsWith(`.${suffix}`)
  );
}

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

function isPrivateIp(address: string) {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version !== 6) return true;
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  if (normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true;
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}

async function validateUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ParIntakeError("LexisNexis document URL is invalid.", 422);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) {
    throw new ParIntakeError("LexisNexis document URL must be credential-free HTTPS on the default port.", 422);
  }
  if (!isAllowedHost(url.hostname)) {
    throw new ParIntakeError(
      "LexisNexis document URL host is not approved. Configure LEXISNEXIS_DOCUMENT_HOSTS if the provider assigns a new delivery host.",
      422
    );
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new ParIntakeError("LexisNexis document URL resolved to a private or unsafe address.", 422);
  }
  return url;
}

async function readCapped(response: Response) {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (declaredLength > PAR_REMOTE_FETCH_MAX_BYTES) {
    throw new ParIntakeError("LexisNexis PAR exceeds the 8 MB remote intake limit.", 413);
  }
  if (!response.body) throw new ParIntakeError("LexisNexis PAR response contained no body.", 502);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > PAR_REMOTE_FETCH_MAX_BYTES) {
      await reader.cancel();
      throw new ParIntakeError("LexisNexis PAR exceeds the 8 MB remote intake limit.", 413);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export async function fetchRemoteLexisPar(value: string) {
  let url = await validateUrl(value);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
        headers: { Accept: "application/pdf,image/jpeg,image/png,image/webp" },
      });
    } catch (error) {
      throw new ParIntakeError(
        `LexisNexis PAR download failed: ${error instanceof Error ? error.message : "network error"}`,
        502
      );
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) {
        throw new ParIntakeError("LexisNexis PAR download exceeded the redirect limit.", 502);
      }
      url = await validateUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      throw new ParIntakeError(`LexisNexis PAR download returned HTTP ${response.status}.`, 502);
    }
    return {
      bytes: await readCapped(response),
      mimeType: response.headers.get("content-type")?.split(";", 1)[0] ?? null,
      filename: decodeURIComponent(url.pathname.split("/").pop() || "police-accident-report.pdf"),
    };
  }
  throw new ParIntakeError("LexisNexis PAR download failed.", 502);
}
