export interface VideoMetadata {
  name: string;
  mimeType: string;
  size: number;
  expiresAt: number;
}

const cache = new Map<string, VideoMetadata>();
const TTL = 5 * 60 * 1000;

export function getVideoMetadata(key: string): VideoMetadata | undefined {
  const item = cache.get(key);
  if (!item || item.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return item;
}

export function setVideoMetadata(key: string, metadata: Omit<VideoMetadata, "expiresAt">) {
  cache.set(key, { ...metadata, expiresAt: Date.now() + TTL });
}
