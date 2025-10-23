"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const MIME_TYPES = ["audio/webm", "audio/ogg", "audio/wav"];
const DEFAULT_MIME_TYPE = MIME_TYPES[0];

type VoiceRecorderProps = {
  onText?: (text: string) => void;
};

type RecorderState = "idle" | "recording" | "uploading" | "error";

export function VoiceRecorder({ onText }: VoiceRecorderProps) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const [status, setStatus] = useState<RecorderState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const resetRecorder = useCallback(() => {
    chunksRef.current = [];
    mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop());
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      resetRecorder();
    };
  }, [resetRecorder]);

  const startRecording = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setMessage("当前浏览器不支持音频录制。");
      setStatus("error");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? DEFAULT_MIME_TYPE;
      const recorder = new MediaRecorder(stream, { mimeType });

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onerror = (event) => {
        console.error("MediaRecorder error", event);
        setMessage("录音过程中出现错误。");
        setStatus("error");
      };

      recorder.onstop = async () => {
        if (chunksRef.current.length === 0) {
          setStatus("idle");
          return;
        }

        setStatus("uploading");

        try {
          const blob = new Blob(chunksRef.current, { type: recorder.mimeType });
          const formData = new FormData();
          formData.append("audio", blob, `recording.${blob.type.split("/")[1] ?? "webm"}`);

          const response = await fetch("/api/asr", {
            method: "POST",
            body: formData
          });

          const payload = await response.json();

          if (!response.ok || !payload.ok) {
            throw new Error(payload?.error ?? "语音识别失败");
          }

          if (payload.data?.text && typeof payload.data.text === "string") {
            onText?.(payload.data.text);
            setMessage("语音识别成功。");
          } else {
            setMessage("未识别到有效文本。");
          }

          setStatus("idle");
        } catch (error) {
          const fallback = error instanceof Error ? error.message : "语音识别失败，请稍后重试。";
          setMessage(fallback);
          setStatus("error");
        } finally {
          chunksRef.current = [];
        }
      };

      chunksRef.current = [];
      mediaRecorderRef.current = recorder;
      recorder.start();
      setStatus("recording");
      setMessage("正在录音，点击停止以识别。");
    } catch (error) {
      console.error("Failed to start recording", error);
      const fallback = error instanceof DOMException && error.name === "NotAllowedError"
        ? "需要麦克风权限才能录音。"
        : "无法启动录音，请检查设备和权限。";
      setMessage(fallback);
      setStatus("error");
    }
  }, [onText]);

  const stopRecording = useCallback(() => {
    const recorder = mediaRecorderRef.current;

    if (!recorder || recorder.state !== "recording") {
      return;
    }

    recorder.stop();
    recorder.stream.getTracks().forEach((track) => track.stop());
  }, []);

  const handleToggle = useCallback(() => {
    if (status === "recording") {
      stopRecording();
    } else if (status === "idle" || status === "error") {
      startRecording();
    }
  }, [startRecording, stopRecording, status]);

  const disabled = status === "uploading";

  return (
    <div className="flex flex-col gap-2 text-sm">
      <button
        type="button"
        className="rounded bg-blue-600 px-4 py-2 text-white disabled:bg-blue-300"
        onClick={handleToggle}
        disabled={disabled}
      >
        {status === "recording" ? "停止录音" : "开始录音"}
      </button>
      <p className="text-neutral-500">
        {status === "recording"
          ? "录音中..."
          : status === "uploading"
          ? "上传并识别中..."
          : message ?? "点击开始录音进行语音转写"}
      </p>
    </div>
  );
}
