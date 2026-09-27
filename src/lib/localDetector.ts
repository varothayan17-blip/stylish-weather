/**
 * localDetector.ts — On-device face and person detection.
 *
 * ── RUNTIME ──────────────────────────────────────────────────────────────────
 *
 * Uses @mediapipe/tasks-vision@1.0.1 (FaceDetector + ObjectDetector).
 * All assets are self-hosted under /public/mediapipe/ — no CDN fetch at runtime.
 *
 * ── DETECTORS ────────────────────────────────────────────────────────────────
 *
 * FaceDetector (BlazeFace short-range, 229 KB)
 *   minDetectionConfidence: 0.4
 *   Conservative threshold (below MediaPipe default 0.5) to maximise recall.
 *   We prefer blocking a garment photo with a face-like graphic over missing
 *   a real face. Claude independently refuses face images server-side.
 *
 * ObjectDetector (EfficientDet Lite0 uint8, 4.4 MB, COCO "person" class)
 *   scoreThreshold: 0.4
 *   categoryAllowlist: ["person"]
 *   runningMode: "IMAGE"
 *   Same conservative rationale: a partial/occluded person at 0.41 is blocked.
 *   Covers seated, back-facing, cropped, or otherwise non-poseable people that
 *   a pose estimator would miss.
 *
 * ── WHY TWO DETECTORS ────────────────────────────────────────────────────────
 *
 * FaceDetector catches faces quickly (smaller model, faster).
 * ObjectDetector catches bodies that have no visible face.
 * Together they cover the full range of prohibited person content.
 *
 * ── PURPOSE ──────────────────────────────────────────────────────────────────
 *
 * Privacy safeguard ONLY — not a security boundary.
 * Goal: prevent prohibited images leaving the device.
 * Authoritative gate: Claude's server-side system prompt independently refuses
 * images containing people, faces, bodies, IDs or personal information.
 * Client detection can be bypassed; server refusal cannot.
 *
 * ── FAILURE POLICY ───────────────────────────────────────────────────────────
 *
 * Every failure path BLOCKS the upload. Detection is never silently bypassed.
 * Reasons that block:
 *   "face"             — FaceDetector found ≥1 face above threshold
 *   "person"           — ObjectDetector found ≥1 person above threshold
 *   "init_failed"      — WASM runtime or model failed to initialize
 *   "inference_failed" — a detector threw during .detect()
 *
 * On init failure the cached Promise is cleared so the user can retry.
 *
 * ── LAZY LOADING ─────────────────────────────────────────────────────────────
 *
 * Imported via `await import("@/lib/localDetector")` inside analyze() only.
 * Not in the initial application bundle.
 * Detector instances are cached and reused across scans in the same session.
 *
 * ── RACE SAFETY ──────────────────────────────────────────────────────────────
 *
 * A single module-level Promise (initPromise) is set before the first await,
 * so concurrent scan attempts attach to the same Promise instead of spawning
 * duplicate initializations. On failure, the Promise is cleared so retry works.
 *
 * ── BUNDLED ASSETS ───────────────────────────────────────────────────────────
 *
 * All files are committed to public/mediapipe/. Licences: Apache 2.0.
 *
 *   public/mediapipe/wasm/vision_wasm_internal.js          323,377 B
 *   public/mediapipe/wasm/vision_wasm_internal.wasm     11,756,954 B  (SIMD)
 *   public/mediapipe/wasm/vision_wasm_nosimd_internal.js   323,180 B
 *   public/mediapipe/wasm/vision_wasm_nosimd_internal.wasm 10,960,242 B  (noSIMD)
 *   public/mediapipe/models/face_detection_short_range.tflite  229,032 B
 *     SHA-256: 3bc182eb9f33925d9e58b5c8d59308a760f4adea8f282370e428c51212c26633
 *     Source:  @mediapipe/face_detection@0.4.1646425229 (npm)
 *   public/mediapipe/models/efficientdet_lite0.tflite        4,563,519 B
 *     SHA-256: 2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b
 *     Source:  https://storage.googleapis.com/mediapipe-tasks/object_detector/efficientdet_lite0_uint8.tflite
 *     Format:  uint8 quantised TFLite flatbuffer with MediaPipe Task metadata (TFL3 magic)
 *
 * WASM source: @mediapipe/tasks-vision@1.0.1 (npm)
 *   SHA-256 vision_wasm_internal.wasm:          8da277a733926eacd0474b8704b36742d6ec3231c57a860c5b889dff8f1df886
 *   SHA-256 vision_wasm_nosimd_internal.wasm:   a28483cd42e74e855bf5ebdb6b40d9b66a5b49e35e95020bc97669e6822a3192
 */

import { FaceDetector, FilesetResolver, ObjectDetector } from "@mediapipe/tasks-vision";

// ── Asset paths ───────────────────────────────────────────────────────────────

const WASM_BASE        = "/mediapipe/wasm";
const FACE_MODEL_PATH  = "/mediapipe/models/blaze_face_short_range.tflite";
const PERSON_MODEL_PATH = "/mediapipe/models/efficientdet_lite0.tflite";

// ── Confidence thresholds ─────────────────────────────────────────────────────

/**
 * Conservative face detection confidence threshold (0.4, below default 0.5).
 * Maximises recall: prefer false positives over false negatives.
 * A printed face graphic may block the upload; the user retries with a plain
 * garment photo. The alternative — missing a real face — is worse.
 */
const FACE_CONFIDENCE_THRESHOLD = 0.4;

/**
 * Conservative COCO person score threshold (0.4, below default 0.5).
 * Same rationale: a partially visible person at score 0.41 is blocked.
 * Cases below this threshold are handled server-side by Claude.
 */
const PERSON_CONFIDENCE_THRESHOLD = 0.4;

// ── Module-level cached state ─────────────────────────────────────────────────

let initPromise: Promise<{
  faceDetector:   FaceDetector;
  personDetector: ObjectDetector;
}> | null = null;

let cachedFaceDetector:   FaceDetector   | null = null;
let cachedPersonDetector: ObjectDetector | null = null;

// ── Initialization ────────────────────────────────────────────────────────────

/**
 * Initialize both detectors, caching the result.
 * Concurrent calls share a single Promise (race-safe).
 * On failure: clears cached Promise so the next call retries fresh.
 */
async function ensureInitialized(): Promise<{
  faceDetector:   FaceDetector;
  personDetector: ObjectDetector;
}> {
  // Return cached instances immediately if available
  if (cachedFaceDetector !== null && cachedPersonDetector !== null) {
    return { faceDetector: cachedFaceDetector, personDetector: cachedPersonDetector };
  }

  // Attach to an in-flight initialization Promise
  if (initPromise !== null) {
    return initPromise;
  }

  // Start initialization — assign before first await so concurrent callers attach here
  initPromise = (async () => {
    let fileset;
    try {
      fileset = await FilesetResolver.forVisionTasks(WASM_BASE);
    } catch (err) {
      initPromise = null; // clear so retry is possible
      throw new Error(
        `WASM runtime failed to load from ${WASM_BASE}: ` +
        (err instanceof Error ? err.message : String(err)),
      );
    }

    let faceDetector: FaceDetector;
    try {
      faceDetector = await FaceDetector.createFromModelPath(fileset, FACE_MODEL_PATH);
      await faceDetector.setOptions({
        runningMode:             "IMAGE",
        minDetectionConfidence:  FACE_CONFIDENCE_THRESHOLD,
        minSuppressionThreshold: 0.3,
      });
    } catch (err) {
      initPromise = null;
      throw new Error(
        `FaceDetector failed to initialize from ${FACE_MODEL_PATH}: ` +
        (err instanceof Error ? err.message : String(err)),
      );
    }

    let personDetector: ObjectDetector;
    try {
      personDetector = await ObjectDetector.createFromModelPath(fileset, PERSON_MODEL_PATH);
      await personDetector.setOptions({
        runningMode:       "IMAGE",
        scoreThreshold:    PERSON_CONFIDENCE_THRESHOLD,
        categoryAllowlist: ["person"],
      });
    } catch (err) {
      faceDetector.close();
      initPromise = null;
      throw new Error(
        `ObjectDetector failed to initialize from ${PERSON_MODEL_PATH}: ` +
        (err instanceof Error ? err.message : String(err)),
      );
    }

    cachedFaceDetector   = faceDetector;
    cachedPersonDetector = personDetector;
    return { faceDetector, personDetector };
  })();

  // Propagate; initPromise is already cleared in inner catch blocks
  return initPromise;
}

// ── Public API ────────────────────────────────────────────────────────────────

export type DetectionResult =
  | { ok: true }
  | {
      ok:     false;
      reason: "face" | "person" | "init_failed" | "inference_failed";
    };

/**
 * Run face and person detection on a canvas element.
 *
 * Must be called BEFORE any network upload or Anthropic invocation.
 * The caller (AddClothingSheet) ensures this ordering.
 *
 * Results:
 *   { ok: true }                            — no face/person detected; proceed
 *   { ok: false, reason: "face" }           — face detected; block upload
 *   { ok: false, reason: "person" }         — person (no face) detected; block upload
 *   { ok: false, reason: "init_failed" }    — WASM/model init failed; block; retry later
 *   { ok: false, reason: "inference_failed" } — .detect() threw; block; retry
 *
 * Every failure path BLOCKS. Detection is never silently bypassed.
 *
 * Resource note: caller owns the canvas. Detector instances are reused (Tasks
 * Vision IMAGE-mode detectors are designed for multi-call reuse).
 */
export async function runLocalDetection(
  canvas: HTMLCanvasElement,
): Promise<DetectionResult> {
  let detectors: { faceDetector: FaceDetector; personDetector: ObjectDetector };
  try {
    detectors = await ensureInitialized();
  } catch {
    return { ok: false, reason: "init_failed" };
  }

  const { faceDetector, personDetector } = detectors;

  // Face detection first — faster (smaller model)
  try {
    const faceResult = faceDetector.detect(canvas);
    if (faceResult.detections.length > 0) {
      return { ok: false, reason: "face" };
    }
  } catch {
    return { ok: false, reason: "inference_failed" };
  }

  // Person detection — COCO "person" class; catches bodies without a visible face
  try {
    const personResult = personDetector.detect(canvas);
    // scoreThreshold and categoryAllowlist were applied at setOptions() time.
    // Any detection returned is a "person" above the threshold.
    if (personResult.detections.length > 0) {
      return { ok: false, reason: "person" };
    }
  } catch {
    return { ok: false, reason: "inference_failed" };
  }

  return { ok: true };
}

/**
 * Reset cached state. For test isolation and hard retry only.
 * @internal
 */
export function _resetForTest(): void {
  initPromise          = null;
  cachedFaceDetector   = null;
  cachedPersonDetector = null;
}

/** Exported constants for test assertions. @internal */
export const _FACE_CONFIDENCE_THRESHOLD   = FACE_CONFIDENCE_THRESHOLD;
export const _PERSON_CONFIDENCE_THRESHOLD = PERSON_CONFIDENCE_THRESHOLD;
