import { loadEnv } from "../../core/config/env";
import type { ASRClient, ASRResult } from "../../core/ports/asr";

const PLACEHOLDER_RESULT: ASRResult = {
  text: "This is a placeholder transcription from iFlytek adapter.",
  confidence: 0.5
};

export class IFlytekASRClient implements ASRClient {
  private readonly appId?: string;
  private readonly apiKey?: string;
  private readonly apiSecret?: string;

  constructor(appId?: string, apiKey?: string, apiSecret?: string) {
    const env = loadEnv();

    this.appId = appId ?? env.IFLYTEK_APP_ID;
    this.apiKey = apiKey ?? env.IFLYTEK_API_KEY;
    this.apiSecret = apiSecret ?? env.IFLYTEK_API_SECRET;
  }

  async recognizeOnce(_buffer: ArrayBuffer | Buffer, _mimeType?: string): Promise<ASRResult> {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[ASR][iFlytek] Using placeholder transcription. Implement real SDK integration when available."
      );
    }

    return PLACEHOLDER_RESULT;
  }
}
