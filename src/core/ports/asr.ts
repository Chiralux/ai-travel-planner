export type ASRResult = {
  text: string;
  confidence?: number;
};

export interface ASRClient {
  recognizeOnce(buffer: ArrayBuffer | Buffer, mimeType?: string): Promise<ASRResult>;
}
