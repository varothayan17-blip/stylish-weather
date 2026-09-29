/**
 * Local-only wardrobe reference-photo storage.
 *
 * Photos are stored as small, re-encoded JPEG thumbnails in IndexedDB. They are
 * never written to localStorage, Firestore, Firebase Storage, or an API. The
 * database is intentionally separate from wardrobe metadata so old items remain
 * valid and browsers that block IndexedDB simply fall back to the existing tile.
 */

import { useEffect, useState } from "react";

const DB_NAME = "aeruvo-wardrobe-media";
const DB_VERSION = 1;
const STORE_NAME = "photos";

let revision = 0;
const listeners = new Set<() => void>();

function emit(): void {
  revision += 1;
  listeners.forEach((listener) => listener());
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("On-device photo storage is unavailable."));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open photo storage."));
    request.onblocked = () => reject(new Error("Photo storage is blocked by another app tab."));
  });
}

async function runRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => reject(request.error ?? new Error("Photo storage request failed."));
    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error ?? new Error("Photo storage transaction failed."));
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error ?? new Error("Photo storage transaction was aborted."));
    };
  });
}

export async function saveWardrobePhoto(itemId: string, blob: Blob): Promise<void> {
  if (!itemId || !blob || blob.size === 0) throw new Error("Invalid wardrobe photo.");
  await runRequest("readwrite", (store) => store.put(blob, itemId));
  emit();
}

export async function loadWardrobePhoto(itemId: string): Promise<Blob | null> {
  if (!itemId) return null;
  const result = await runRequest<Blob | undefined>("readonly", (store) => store.get(itemId));
  return result instanceof Blob ? result : null;
}

export async function deleteWardrobePhoto(itemId: string): Promise<void> {
  if (!itemId || typeof indexedDB === "undefined") return;
  await runRequest("readwrite", (store) => store.delete(itemId));
  emit();
}

export async function clearWardrobePhotos(): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await runRequest("readwrite", (store) => store.clear());
  emit();
}

/**
 * Re-encode a scan image as a small JPEG reference thumbnail. Canvas encoding
 * removes EXIF metadata and discards the original resolution/image bytes.
 */
export async function createWardrobeThumbnail(
  source: Blob,
  maxDimension = 480,
  quality = 0.76,
): Promise<Blob> {
  if (!source || source.size === 0) throw new Error("No photo selected.");

  const bitmap = await createImageBitmap(source);
  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas unavailable.");
    context.drawImage(bitmap, 0, 0, width, height);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode reference photo."))),
        "image/jpeg",
        quality,
      );
    });
  } finally {
    bitmap.close();
  }
}

export function useWardrobePhotoUrl(itemId: string | undefined, enabled: boolean): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const [photoRevision, setPhotoRevision] = useState(revision);

  useEffect(() => {
    const listener = () => setPhotoRevision(revision);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);

    if (!enabled || !itemId) return () => undefined;

    loadWardrobePhoto(itemId)
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [itemId, enabled, photoRevision]);

  return url;
}
