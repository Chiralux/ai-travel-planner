import { existsSync, promises as fs } from "node:fs";
import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "cross-spawn";
import WebSocket from "ws";
import ffmpegPath from "ffmpeg-static";
import { loadEnv } from "../../core/config/env";
import type { ASRClient, ASRResult } from "../../core/ports/asr";

type DecodedResult = {
  sn: number;
  ls?: boolean;
  ws?: Array<{
    cw?: Array<{
      w?: string;
      sc?: number;
    }>;
  }>;
  pgs?: "apd" | "rpl";
  rg?: [number, number];
};

const DEFAULT_HOST = "iat.xf-yun.com";
const DEFAULT_PATH = "/v1";
const DEFAULT_DOMAIN = "iat";
const FRAME_BYTES = 1280;
const ERROR_CODE_HINTS: Record<number, string> = {
  11201: "Check IFLYTEK_DOMAIN/IFLYTEK_HOST settings and confirm your account has access to the chosen service domain.",
  10404: "The requested domain/path combination is unavailable. Ensure IFLYTEK_DOMAIN matches your application's enabled product line and adjust IFLYTEK_HOST/IFLYTEK_PATH if required."
};

function decodeTextPayload(base64: string): DecodedResult {
  const json = Buffer.from(base64, "base64").toString("utf8");

  try {
    return JSON.parse(json) as DecodedResult;
  } catch (error) {
    throw new Error(`Failed to parse iFlytek result payload: ${(error as Error).message}`);
  }
}

async function transcodeToPCM16K(buffer: Buffer, ext: string) {
  const resolvedFfmpegPath = resolveFfmpegBinary();

  const sessionDir = join(tmpdir(), `iflytek-${randomUUID()}`);
  const inputPath = join(sessionDir, `input.${ext}`);
  const outputPath = join(sessionDir, "output.pcm");

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(inputPath, buffer);

  await new Promise<void>((resolve, reject) => {
    const args = [
      "-y",
      "-i",
      inputPath,
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "s16le",
      outputPath
    ];

  const proc = spawn(resolvedFfmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    if (proc.stderr) {
      proc.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
    }

    proc.once("error", reject);
    proc.once("close", (code: number | null) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code ?? "unknown"}. ${stderr}`));
      }
    });
  });

  try {
    const pcm = await fs.readFile(outputPath);
    return pcm;
  } finally {
    await fs.rm(sessionDir, { recursive: true, force: true });
  }
}

function resolveFfmpegBinary() {
  const candidates = [
    process.env.FFMPEG_PATH,
    typeof ffmpegPath === "string" ? ffmpegPath : undefined,
    join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg.exe"),
    join(process.cwd(), "node_modules", "ffmpeg-static", "ffmpeg")
  ].filter((value): value is string => typeof value === "string" && value.length > 0);

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error("ffmpeg binary not found. Set FFMPEG_PATH or ensure ffmpeg-static is installed.");
}

function pickExtension(mimeType?: string) {
  if (!mimeType) {
    return "bin";
  }

  if (mimeType.includes("wav")) {
    return "wav";
  }

  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) {
    return "mp3";
  }

  if (mimeType.includes("ogg")) {
    return "ogg";
  }

  if (mimeType.includes("webm")) {
    return "webm";
  }

  return "bin";
}

function buildAuthorization(apiKey: string, apiSecret: string, host: string, path: string, date: string) {
  const normalizedPath = normalizePath(path);
  const requestLine = `GET ${normalizedPath} HTTP/1.1`;
  const signatureOrigin = `host: ${host}\ndate: ${date}\n${requestLine}`;
  const signatureSha = crypto.createHmac("sha256", apiSecret).update(signatureOrigin).digest("base64");
  const authorizationOrigin = `api_key=\"${apiKey}\", algorithm=\"hmac-sha256\", headers=\"host date request-line\", signature=\"${signatureSha}\"`;
  const authorization = Buffer.from(authorizationOrigin).toString("base64");

  return { signature: signatureSha, authorization };
}

function buildUrl(apiKey: string, apiSecret: string, host: string, path: string, date: string) {
  const { authorization } = buildAuthorization(apiKey, apiSecret, host, path, date);
  const query = new URLSearchParams({
    authorization,
    date,
    host
  });

  const normalizedPath = normalizePath(path);
  return `wss://${host}${normalizedPath}?${query.toString()}`;
}

function normalizePath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function frameAudio(pcm: Buffer) {
  const frames: Buffer[] = [];

  for (let offset = 0; offset < pcm.length; offset += FRAME_BYTES) {
    frames.push(pcm.subarray(offset, Math.min(offset + FRAME_BYTES, pcm.length)));
  }

  if (frames.length === 0) {
    frames.push(Buffer.alloc(0));
  }

  return frames;
}

function aggregateResult(results: Map<number, string>) {
  return Array.from(results.keys())
    .sort((a, b) => a - b)
    .map((key) => results.get(key) ?? "")
    .join("");
}

function decodeSegment(payload: DecodedResult) {
  if (!payload.ws) {
    return "";
  }

  return payload.ws
    .flatMap((item) => item.cw ?? [])
    .map((candidate) => candidate.w ?? "")
    .join("");
}

async function waitForWebSocketReady(socket: WebSocket) {
  if (socket.readyState === WebSocket.OPEN) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const onOpen = () => {
      cleanup();
      resolve();
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    const cleanup = () => {
      socket.removeListener("open", onOpen);
      socket.removeListener("error", onError);
    };

    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}

export class IFlytekASRClient implements ASRClient {
  private readonly appId?: string;
  private readonly apiKey?: string;
  private readonly apiSecret?: string;
  private readonly host: string;
  private readonly path: string;
  private readonly domain: string;
  private readonly useV2Protocol: boolean;

  constructor(appId?: string, apiKey?: string, apiSecret?: string) {
    const env = loadEnv();

    this.appId = appId ?? env.IFLYTEK_APP_ID;
    this.apiKey = apiKey ?? env.IFLYTEK_API_KEY;
    this.apiSecret = apiSecret ?? env.IFLYTEK_API_SECRET;
  this.host = (env.IFLYTEK_HOST ?? DEFAULT_HOST).trim();
  this.path = (env.IFLYTEK_PATH ?? DEFAULT_PATH).trim();
  this.domain = (env.IFLYTEK_DOMAIN ?? DEFAULT_DOMAIN).trim();
    this.useV2Protocol = this.path.includes("/v2/");
  }

  async recognizeOnce(buffer: ArrayBuffer | Buffer, mimeType?: string): Promise<ASRResult> {
    if (!this.appId || !this.apiKey || !this.apiSecret) {
      throw new Error("Missing iFlytek credentials. Please configure IFLYTEK_APP_ID, IFLYTEK_API_KEY, IFLYTEK_API_SECRET.");
    }

    const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const pcm = await transcodeToPCM16K(input, pickExtension(mimeType));
    const frames = frameAudio(pcm);
    const date = new Date().toUTCString();
  const url = buildUrl(this.apiKey, this.apiSecret, this.host, this.path, date);

    const socket = new WebSocket(url, { handshakeTimeout: 10000 });
    await waitForWebSocketReady(socket);

    let finalResolve: (value: ASRResult) => void;
    let finalReject: (reason?: unknown) => void;

    const resultPromise = new Promise<ASRResult>((resolve, reject) => {
      finalResolve = resolve;
      finalReject = reject;
    });

    const sentences = new Map<number, string>();

    socket.on("message", (event: WebSocket.RawData) => {
      const data = typeof event === "string" ? event : event.toString("utf8");
      let payload: any;

      try {
        payload = JSON.parse(data);
      } catch (error) {
        finalReject(new Error(`Failed to parse iFlytek response: ${(error as Error).message}`));
        socket.close();
        return;
      }

      if (this.useV2Protocol) {
        if (!this.handleV2Message(payload, sentences, finalResolve, finalReject, socket)) {
          socket.close();
        }
        return;
      }

      const header = payload?.header;
      if (!header) {
        const raw = typeof data === "string" ? data : JSON.stringify(payload);
        console.error("[ASR] Unexpected iFlytek message without header:", raw);
        finalReject(new Error("Invalid iFlytek response: missing header"));
        socket.close();
        return;
      }

      if (typeof header.code === "number" && header.code !== 0) {
        const hint = ERROR_CODE_HINTS[header.code];
        const suffix = hint ? ` Hint: ${hint}` : "";
        finalReject(new Error(`iFlytek error ${header.code}: ${header.message ?? "unknown"}.${suffix}`));
        socket.close();
        return;
      }

      const result = payload?.payload?.result;
      if (result?.text) {
        const decoded = decodeTextPayload(result.text);
        const segment = decodeSegment(decoded);

        if (decoded.pgs === "rpl" && Array.isArray(decoded.rg) && decoded.rg.length === 2) {
          for (let index = decoded.rg[0]; index <= decoded.rg[1]; index += 1) {
            sentences.delete(index);
          }
        }

        sentences.set(decoded.sn, segment);
      }

      if (header.status === 2) {
        const transcript = aggregateResult(sentences).trim();
        const confidences: number[] = Array.from(sentences.values()).map((text) => (text ? 0.95 : 0));
        const confidence = confidences.length > 0 ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0.9;

        finalResolve({
          text: transcript,
          confidence
        });

        socket.close();
      }
    });

    socket.on("error", (error: Error) => {
      finalReject(error);
      socket.close();
    });

    socket.on("close", (code: number) => {
      if (code !== 1000) {
        finalReject(new Error(`WebSocket closed unexpectedly with code ${code}`));
      }
    });

    // send frames
    frames.forEach((frame, index) => {
      const status = index === 0 ? 0 : index === frames.length - 1 ? 2 : 1;
      const audioBase64 = frame.toString("base64");

      const body = this.useV2Protocol
        ? this.createV2Frame(status, index, audioBase64)
        : this.createV1Frame(status, index, audioBase64);

      socket.send(JSON.stringify(body));
    });

    // final frame to mark end if not already
    if (frames.length === 0 || frames[frames.length - 1].length !== 0) {
      const body = this.useV2Protocol
        ? this.createV2Frame(2, frames.length, "")
        : this.createV1Frame(2, frames.length, "");

      socket.send(JSON.stringify(body));
    }

    return resultPromise;
  }

  private createV1Frame(status: number, seq: number, audio: string) {
    const frame: Record<string, unknown> = {
      header: {
        app_id: this.appId,
        status
      },
      payload: {
        audio: {
          encoding: "raw",
          sample_rate: 16000,
          channels: 1,
          bit_depth: 16,
          status,
          seq,
          audio
        }
      }
    };

    if (status === 0) {
      frame.parameter = {
        iat: {
          domain: this.domain,
          language: "zh_cn",
          accent: "mandarin",
          dwa: "wpgs",
          aue: "raw",
          rate: 16000,
          result: {
            encoding: "utf8",
            compress: "raw",
            format: "json"
          }
        }
      };
    }

    return frame;
  }

  private createV2Frame(status: number, seq: number, audio: string) {
    const frame: Record<string, unknown> = {
      data: {
        status,
        format: "audio/L16;rate=16000",
        encoding: "raw",
        audio
      }
    };

    if (status === 0) {
      frame.common = {
        app_id: this.appId
      };

      frame.business = {
        domain: this.domain,
        language: "zh_cn",
        accent: "mandarin",
        dwa: "wpgs",
        vinfo: 1,
        vad_eos: 10000
      };
    }

    return frame;
  }

  private handleV2Message(
    payload: any,
    sentences: Map<number, string>,
    resolve: (value: ASRResult) => void,
    reject: (reason?: unknown) => void,
    socket: WebSocket
  ) {
    const code = payload?.code;

    if (typeof code === "number" && code !== 0) {
      const hint = ERROR_CODE_HINTS[code];
      const suffix = hint ? ` Hint: ${hint}` : "";
      reject(new Error(`iFlytek error ${code}: ${payload?.message ?? "unknown"}.${suffix}`));
      return false;
    }

    const data = payload?.data;
    if (!data) {
      console.error("[ASR] iFlytek v2 response missing data:", payload);
      reject(new Error("Invalid iFlytek v2 response: missing data"));
      return false;
    }

    const result = data.result;
    if (result) {
      const sn = typeof result.sn === "number" ? result.sn : sentences.size + 1;

      if (result.pgs === "rpl" && Array.isArray(result.rg) && result.rg.length === 2) {
        for (let index = result.rg[0]; index <= result.rg[1]; index += 1) {
          sentences.delete(index);
        }
      }

      const segment = decodeSegment(result);
      sentences.set(sn, segment);
    }

    if (data.status === 2) {
      const transcript = aggregateResult(sentences).trim();
      const confidences: number[] = Array.from(sentences.values()).map((text) => (text ? 0.95 : 0));
      const confidence = confidences.length > 0 ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length : 0.9;

      resolve({
        text: transcript,
        confidence
      });

      return false;
    }

    return true;
  }
}
