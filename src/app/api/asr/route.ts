import { Buffer } from "buffer";
import { NextRequest, NextResponse } from "next/server";
import { loadEnv } from "../../../core/config/env";
import { IFlytekASRClient } from "../../../adapters/asr/iflytek";

const AUDIO_FIELD = "audio";

function missingCredentialsMessage() {
  return "IFLYTEK_APP_ID, IFLYTEK_API_KEY, and IFLYTEK_API_SECRET are required";
}

export async function POST(req: NextRequest) {
  const env = loadEnv();

  if (!env.IFLYTEK_APP_ID || !env.IFLYTEK_API_KEY || !env.IFLYTEK_API_SECRET) {
    return NextResponse.json({ ok: false, error: missingCredentialsMessage() }, { status: 400 });
  }

  let formData: FormData;

  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid form-data payload" }, { status: 400 });
  }

  const file = formData.get(AUDIO_FIELD);

  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: "Missing audio file" }, { status: 400 });
  }

  let buffer: Buffer;

  try {
    const arrayBuffer = await file.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to read audio file";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }

  try {
    const client = new IFlytekASRClient(env.IFLYTEK_APP_ID, env.IFLYTEK_API_KEY, env.IFLYTEK_API_SECRET);
    const result = await client.recognizeOnce(buffer, file.type || undefined);

    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown ASR error";
    console.error("[ASR] recognition failed", error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
