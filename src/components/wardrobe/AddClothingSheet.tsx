/**
 * AddClothingSheet.tsx — Add clothing via AI scan or manual entry.
 *
 * ── Scan pipeline (when enabled) ──────────────────────────────────────────
 *   status-check → pick → preview → compressing → analyzing → confirm → add
 *
 * ── Manual pipeline (when scanning is unavailable) ────────────────────────
 *   status-check → scan-unavailable → manual → add
 *
 * ── Scanning availability ─────────────────────────────────────────────────
 *   GET /api/wardrobe/status is called once when the sheet opens.
 *   The result is cached per session (ref). On any network failure the result
 *   is treated as false (fail-closed) and the manual form is shown instead.
 *   Camera/gallery inputs are never triggered during the status check.
 *   The scan endpoint still enforces its own server-side flag independently.
 *
 * ── Manual entry ──────────────────────────────────────────────────────────
 *   Collects only fields the wardrobe matching engine uses.
 *   No photo, no AI call, no quota consumption.
 *   weatherFit, season, and tint are derived deterministically from user inputs.
 *   The item has no aiAnalysis field and shows no "AI analyzed" copy.
 *
 * ── Security ──────────────────────────────────────────────────────────────
 *   - Firebase ID token sent in Authorization header; server verifies it.
 *   - No uid in request body.
 *   - The original scan image is never persisted after the session.
 *   - With explicit opt-in, only a small re-encoded reference thumbnail is
 *     stored locally in IndexedDB; it is never uploaded to Aeruvo or Firebase.
 *   - AI provider API key never in client bundle.
 */

import { useEffect, useRef, useState } from "react";
import {
  Camera,
  ImageIcon,
  X,
  Sparkles,
  Check,
  AlertCircle,
  RefreshCw,
  PenLine,
  ChevronLeft,
} from "lucide-react";
import { ScanConsentSheet } from "./ScanConsentSheet";
import { CATEGORIES, type WardrobeItem, type WardrobeCategory } from "./wardrobeData";
import {
  resolvePickerRequestWith,
  resolveConsentComplete,
  resolveAuthSwitch,
  type AckCache,
} from "@/lib/pickerConsentLogic";

// ── Controlled garment types ──────────────────────────────────────────────
// Each type string contains a specific token present in production slot strings
// (from clothingProfiles.ts) so the matcher can award the +40 type-hit score.
// GENERIC_TOKENS in wardrobeMatch.ts ("shirt","top",…) cannot score +40 alone;
// these values are chosen to contain the SPECIFIC token the matcher needs.
// Item name is user-facing and must NOT be used for type (name controls +35 score).

type GarmentTypeEntry = { label: string; type: string };

// ── Controlled garment types: correctness notes ──────────────────────────
//
// type field drives the matcher +40 score via tokeniseSlot() matching.
// Rules:
//   • type must contain at least one specific token from a real production slot string.
//   • GENERIC_TOKENS ("shirt","top",…) cannot independently trigger +40.
//   • Descriptive prefixes like "Waterproof" that appear across categories
//     MUST NOT be used in the type for footwear because "Waterproof boots"
//     would then score +40 on the "Waterproof jacket" slot (guessCategory gives
//     Outerwear for that slot, so the Shoes compat rule does not fire).
//     Fix: Shoes use base type "Boots"; high waterResistance encodes waterproofing.
//   • "Waterproof jacket" and "Waterproof shell" are SAFE for Outerwear because
//     the Shoes compat rule blocks Shoes items from Outerwear-guessed slots.
//   • "Turtleneck" is live: "Turtleneck or sweater" is a real women's slot.
//   • Accessories: all slots containing accessory tokens ("beanie","scarf",…)
//     are filtered by matchWardrobeToOutfit skipKeywords or keepKeywords, so
//     Accessories items can never be returned as wardrobe matches. Accessories
//     are retained as a category for catalogue organisation; the matching note
//     is shown in the form.
//
const GARMENT_TYPES: Record<WardrobeCategory, GarmentTypeEntry[]> = {
  Tops: [
    // Each type contains a specific token that appears in a real production slot.
    { label: "T-shirt", type: "T-shirt" }, // token: t-shirt
    { label: "Polo shirt", type: "Polo shirt" }, // token: polo
    { label: "Long-sleeve shirt", type: "Long-sleeve shirt" }, // token: long-sleeve
    { label: "Hoodie", type: "Hoodie" }, // token: hoodie
    { label: "Sweater", type: "Sweater" }, // token: sweater
    { label: "Cardigan", type: "Cardigan" }, // token: cardigan
    { label: "Fleece", type: "Fleece" }, // token: fleece
    { label: "Blouse", type: "Blouse" }, // token: blouse
    { label: "Turtleneck", type: "Turtleneck" }, // token: turtleneck (women's slot)
    { label: "Tank top", type: "Tank top" }, // token: tank
    { label: "Linen shirt", type: "Linen shirt" }, // token: linen
  ],
  Bottoms: [
    { label: "Jeans", type: "Jeans" }, // token: jeans
    { label: "Chinos", type: "Chinos" }, // token: chinos
    { label: "Shorts", type: "Shorts" }, // token: shorts
    { label: "Trousers", type: "Trousers" }, // token: trousers
    { label: "Leggings", type: "Leggings" }, // token: leggings
    { label: "Skirt", type: "Skirt" }, // token: skirt
    { label: "Thermal pants", type: "Thermal pants" }, // token: thermal
  ],
  Outerwear: [
    // "Waterproof jacket" and "Waterproof shell" are safe: Shoes compat rule
    // blocks cross-category collisions for these slots.
    { label: "Jacket", type: "Jacket" }, // token: jacket
    { label: "Coat", type: "Coat" }, // token: coat
    { label: "Parka", type: "Parka" }, // token: parka
    { label: "Waterproof jacket", type: "Waterproof jacket" }, // tokens: waterproof, jacket
    { label: "Windbreaker", type: "Windbreaker" }, // token: windbreaker
    { label: "Fleece jacket", type: "Fleece jacket" }, // tokens: fleece, jacket
    { label: "Puffer jacket", type: "Puffer jacket" }, // token: jacket
    { label: "Waterproof shell", type: "Waterproof shell" }, // tokens: waterproof, shell
  ],
  Shoes: [
    // IMPORTANT: Do NOT use "Waterproof boots" as the type string.
    // "waterproof" is not protected by the Shoes compat rule on Outerwear-guessed slots.
    // Use base type "Boots" and express waterproofing via waterResistance=High.
    { label: "Sneakers", type: "Sneakers" }, // token: sneakers
    { label: "Boots", type: "Boots" }, // token: boots
    { label: "Ankle boots", type: "Ankle boots" }, // token: ankle → boots
    { label: "Sandals", type: "Sandals" }, // token: sandals
    { label: "Waterproof boots", type: "Boots" }, // type=Boots (safe); waterResistance=High
  ],
  Accessories: [
    // Accessories cannot be matched by the wardrobe engine: all accessory-containing
    // slots ("Beanie & scarf", "Sun hat", "Wool socks") are filtered by skipKeywords
    // in matchWardrobeToOutfit. Items in this category appear in the wardrobe catalogue
    // but will not appear in Today's picks or outfit slot matches.
    { label: "Scarf", type: "Scarf" },
    { label: "Beanie", type: "Beanie" },
    { label: "Gloves", type: "Gloves" },
  ],
};

/** Return the first garment type for this category (for default). */
function defaultGarmentType(cat: WardrobeCategory): string {
  return GARMENT_TYPES[cat][0]?.type ?? cat;
}
import type { ClothingAnalysis, ScanStep } from "@/lib/wardrobe-types";
import { getFirebaseAuth } from "@/lib/firebase";
import { getUid, subscribeToAuthState } from "@/lib/auth";
import { fetchAckStatus, checkConsentStatus } from "@/lib/scanConsentApi";
import { createWardrobeThumbnail } from "@/lib/wardrobePhotoStore";

// ── Constants ──────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.6; // below this → show "Estimated" badge

// ── Image compression ──────────────────────────────────────────────────────

const MAX_DIMENSION = 1400;
const JPEG_QUALITY = 0.82;

async function compressImage(file: File): Promise<{ blob: Blob; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const rawUrl = URL.createObjectURL(file);

    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("Canvas unavailable"));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(rawUrl);
            if (!blob) {
              reject(new Error("Canvas encode failed"));
              return;
            }
            resolve({ blob, objectUrl: URL.createObjectURL(blob) });
          },
          "image/jpeg",
          JPEG_QUALITY,
        );
      } catch (err) {
        URL.revokeObjectURL(rawUrl);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(rawUrl);
      reject(new Error("Could not decode image"));
    };
    img.src = rawUrl;
  });
}

// ── Wardrobe scanning status ───────────────────────────────────────────────

/**
 * Check whether AI wardrobe scanning is currently enabled.
 * Returns false on any error (fail-closed — avoids camera prompt when uncertain).
 * Result is cached per sheet session via the ref in the component.
 */
async function fetchScanningStatus(): Promise<boolean> {
  try {
    const res = await fetch("/api/wardrobe/status");
    if (!res.ok) return false;
    const data = (await res.json()) as { scanningEnabled?: boolean };
    return data.scanningEnabled === true;
  } catch {
    return false; // network failure → fail closed, manual form shown
  }
}

// ── AI scan API call ───────────────────────────────────────────────────────

async function scanWithAI(blob: Blob): Promise<ClothingAnalysis> {
  const auth = await getFirebaseAuth();
  const user = auth?.currentUser;
  if (!user) throw new Error("Please sign in to scan clothing.");

  const idToken = await user.getIdToken();
  const res = await fetch("/api/wardrobe/scan", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${idToken}`,
      "Content-Type": blob.type || "image/jpeg",
      "Content-Length": String(blob.size),
    },
    body: blob,
  });

  const data = (await res.json()) as {
    ok: boolean;
    analysis?: ClothingAnalysis;
    error?: string;
    code?: string;
  };

  if (!data.ok) {
    const msg = data.error ?? "Analysis failed. Please try another photo.";
    if (data.code === "quota") throw Object.assign(new Error(msg), { code: "quota" });
    if (data.code === "ack") throw Object.assign(new Error(msg), { code: "ack" });
    if (data.code === "abuse") throw Object.assign(new Error(msg), { code: "abuse" });
    if (data.code === "rejected") throw Object.assign(new Error(msg), { code: "rejected" });
    if (data.code === "wardrobe_scanning_temporarily_unavailable")
      throw Object.assign(new Error(msg), { code: "wardrobe_scanning_temporarily_unavailable" });
    throw new Error(msg);
  }
  if (!data.analysis) throw new Error("No analysis returned. Please try another photo.");

  // Defensive: strip evidence before returning to UI state.
  // New scans never include evidence (server decision a), but guard defensively.
  const { evidence: _stripped, ...analysisWithoutEvidence } = data.analysis;
  return analysisWithoutEvidence as ClothingAnalysis;
}

// ── Analysis → WardrobeItem mapping ───────────────────────────────────────

function analysisToItem(a: ClothingAnalysis): Omit<WardrobeItem, "id"> {
  const categoryMap: Record<string, WardrobeCategory> = {
    tops: "Tops",
    bottoms: "Bottoms",
    outerwear: "Outerwear",
    shoes: "Shoes",
    accessories: "Accessories",
    dress: "Tops",
    other: "Tops",
  };
  const category = categoryMap[a.category] ?? "Tops";

  const warmthMap: Record<string, "Light" | "Medium" | "Warm"> = {
    "very-light": "Light",
    light: "Light",
    medium: "Medium",
    warm: "Warm",
    "very-warm": "Warm",
  };
  const warmth = warmthMap[a.warmth.label] ?? "Medium";

  const waterMap: Record<string, "Low" | "Medium" | "High"> = {
    none: "Low",
    low: "Low",
    unknown: "Low",
    medium: "Medium",
    high: "High",
  };
  const waterResistance = waterMap[a.waterResistance] ?? "Low";

  const tint = colourToTint(a.primaryColor);
  const weatherFit = a.weatherFit.join(" / ") || "All weather";
  const style = a.styles[0] ?? "Casual";
  const season = a.seasons.join(" / ") || "All season";
  const typeParts = [category, a.subcategory].filter(Boolean);

  return {
    name: a.name,
    category,
    type: typeParts.join(" / "),
    color: a.primaryColor,
    warmth,
    weatherFit,
    waterResistance,
    style,
    season,
    labels: [`${warmth} warmth`, style],
    tint,
    aiAnalysis: a,
  } as Omit<WardrobeItem, "id">;
}

function colourToTint(colour: string): string {
  const c = colour.toLowerCase();
  if (c.includes("black") || c.includes("charcoal")) return "from-slate-700/70 to-slate-900/80";
  if (c.includes("white") || c.includes("cream")) return "from-white/80 to-slate-200/70";
  if (c.includes("navy") || c.includes("dark blue")) return "from-blue-800/70 to-indigo-950/80";
  if (c.includes("blue")) return "from-sky-500/60 to-blue-800/70";
  if (c.includes("grey") || c.includes("gray")) return "from-zinc-400/60 to-zinc-700/70";
  if (c.includes("red") || c.includes("crimson")) return "from-red-500/60 to-red-800/70";
  if (c.includes("green") || c.includes("olive")) return "from-green-700/60 to-emerald-900/70";
  if (c.includes("brown") || c.includes("tan") || c.includes("camel"))
    return "from-amber-700/60 to-stone-800/70";
  if (c.includes("beige") || c.includes("sand")) return "from-amber-200/70 to-stone-400/70";
  if (c.includes("yellow") || c.includes("mustard")) return "from-yellow-400/60 to-amber-600/70";
  if (c.includes("pink") || c.includes("rose")) return "from-pink-400/60 to-rose-600/70";
  if (c.includes("purple") || c.includes("violet")) return "from-purple-500/60 to-violet-800/70";
  if (c.includes("orange")) return "from-orange-400/60 to-orange-700/70";
  return "from-slate-500/60 to-slate-700/70";
}

// ── Manual entry helpers ───────────────────────────────────────────────────

/**
 * Derive weatherFit deterministically from warmth + waterResistance.
 * Used for manual entries. Maps to the same strings the AI produces so the
 * wardrobe matcher's weatherFit scoring (+10) works correctly.
 */
function deriveWeatherFit(
  warmth: "Light" | "Medium" | "Warm",
  waterResistance: "Low" | "Medium" | "High",
): string {
  const rain =
    waterResistance === "High" ? " / rain" : waterResistance === "Medium" ? " / light rain" : "";
  if (warmth === "Light") return `Mild / warm${rain}`;
  if (warmth === "Medium") return `Cool / mild${rain}`;
  return `Cold${rain}`;
}

/**
 * Derive season deterministically from warmth.
 * Matches the strings the AI produces so the season scoring (+10) works.
 */
function deriveSeason(warmth: "Light" | "Medium" | "Warm"): string {
  if (warmth === "Light") return "Spring / Summer";
  if (warmth === "Warm") return "Fall / Winter";
  return "All season";
}

// ── Manual form state shape ────────────────────────────────────────────────

interface ManualFields {
  name: string;
  category: WardrobeCategory;
  garmentType: string; // controlled vocabulary — drives matcher +40 score
  color: string;
  warmth: "Light" | "Medium" | "Warm";
  waterResistance: "Low" | "Medium" | "High";
  style: string;
}

const MANUAL_DEFAULTS: ManualFields = {
  name: "",
  category: "Tops",
  garmentType: "T-shirt", // first entry for Tops
  color: "",
  warmth: "Medium",
  waterResistance: "Low",
  style: "Casual",
};

interface ManualErrors {
  name?: string;
  category?: string;
  color?: string;
}

function validateManual(f: ManualFields): ManualErrors {
  const e: ManualErrors = {};
  if (!f.name.trim()) e.name = "Item name is required.";
  if (!f.category) e.category = "Category is required.";
  if (!f.color.trim()) e.color = "Colour is required.";
  return e;
}

function manualToItem(f: ManualFields): Omit<WardrobeItem, "id"> {
  const weatherFit = deriveWeatherFit(f.warmth, f.waterResistance);
  const season = deriveSeason(f.warmth);
  const tint = colourToTint(f.color);
  // type uses the CONTROLLED garment type (not the user name) so the
  // wardrobe matcher can reliably award the +40 type-hit score.
  // item.name is the user-facing label and drives the separate +35 score.
  const type = f.garmentType;
  return {
    name: f.name.trim(),
    category: f.category,
    type,
    color: f.color.trim(),
    warmth: f.warmth,
    weatherFit,
    waterResistance: f.waterResistance,
    style: f.style || "Casual",
    season,
    tint,
    labels: [`${f.warmth} warmth`, f.style || "Casual"],
    // No aiAnalysis — this is a manual entry
  };
}

// ── Auth sentinel (module-level, stable across renders) ───────────────────
// Used by observedAuthUidRef to detect first (initial) auth emission.
const INITIAL_AUTH_SENTINEL = Symbol("initial");

// ── Component ──────────────────────────────────────────────────────────────

export function AddClothingSheet({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (item: Omit<WardrobeItem, "id">, referencePhoto?: Blob) => Promise<void>;
}) {
  // V4: initial step is "status-check" — camera/library UI must not render
  // until fetchScanningStatus confirms enabled=true (fail-closed).
  const [step, setStep] = useState<ScanStep>("status-check");
  const [previewUrl, setPreview] = useState<string | null>(null);
  const [imageBlob, setBlob] = useState<Blob | null>(null);
  const [analysis, setAnalysis] = useState<ClothingAnalysis | null>(null);
  const [draft, setDraft] = useState<Omit<WardrobeItem, "id"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isQuotaError, setIsQuota] = useState(false);
  const [saveReferencePhoto, setSaveReferencePhoto] = useState(false);
  const [addingItem, setAddingItem] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Consent state — tracks whether current user has completed scan setup.
  // Stored in a mutable ref object (AckCache) so resolvePickerRequestWith
  // can mutate it synchronously without a re-render cycle.
  const ackCacheRef = useRef<AckCache>({ checked: null, uid: null });

  // Whether the consent setup sheet is open
  const [consentSheetOpen, setConsentSheetOpen] = useState(false);
  // UID of the user for whom the consent sheet was opened (ownership guard)
  const [consentSheetUid, setConsentSheetUid] = useState<string | null>(null);

  // Manual entry form
  const [manual, setManual] = useState<ManualFields>(MANUAL_DEFAULTS);
  const [manualErrors, setManualErr] = useState<ManualErrors>({});
  const manualNameRef = useRef<HTMLInputElement>(null);

  // Scanning availability — checked once per sheet session on open.
  const scanEnabledRef = useRef<boolean | null>(null);

  // Pending picker action — remembered when consent is required mid-flow.
  const pendingPickerAction = useRef<"camera" | "library" | null>(null);

  // pickerReadyAction — set AFTER consent completes; triggers a fresh synchronous
  // CTA button so input.click() is called from a real user gesture (item 1).
  const [pickerReadyAction, setPickerReadyAction] = useState<"camera" | "library" | null>(null);

  // V4: consentJustCompleted — distinguishes "newly set up" from "already had consent"
  // for picker-ready wording (Item 8).
  const [consentJustCompleted, setConsentJustCompleted] = useState(false);

  // V4: resumeAfterConsent — stores blob for ack-required mid-analysis recovery.
  // When server returns ack-required for a stable UID, we preserve the blob here.
  // After consent completes for that same UID, we return to step="preview" (Item 5).
  const resumeAfterConsent = useRef<{ uid: string; blob: Blob } | null>(null);

  // V4: analysisRequestIdRef — stale success/error responses cannot update UI
  // for a different account/request (Item 4).
  const analysisRequestIdRef = useRef(0);

  // V5: fileRequestIdRef — incremented on every new file selection, UID change,
  // sheet close, reset and goToManual. Guards handleFileChange so compressed
  // results from a prior selection or a prior account never update state.
  const fileRequestIdRef = useRef(0);

  // V5: selectedFileOwnerUidRef — the UID verified at the moment the picker was
  // opened. handleFileChange rejects any compressed result if the current UID
  // no longer equals this value.
  const selectedFileOwnerUidRef = useRef<string | null>(null);

  // V5: pickerRequestIdRef — incremented on every new picker request, UID change,
  // sheet close, reset and goToManual. Guards handlePickerRequest so a stale
  // resolvePickerRequestWith result cannot open consent or picker-ready for the
  // wrong account.
  const pickerRequestIdRef = useRef(0);

  // V4: observedAuthUidRef with initial-emission sentinel — first auth callback
  // only records the UID; it must not override scanner status step (Item 2).
  const observedAuthUidRef = useRef<string | null | typeof INITIAL_AUTH_SENTINEL>(
    INITIAL_AUTH_SENTINEL,
  );

  // Hidden file inputs
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Reset all state when sheet closes
  useEffect(() => {
    if (!open) {
      // V4: reset to "status-check" (fail-closed), never "pick"
      setStep("status-check");
      setAnalysis(null);
      setDraft(null);
      setError(null);
      setIsQuota(false);
      setSaveReferencePhoto(false);
      setAddingItem(false);
      setAddError(null);
      setBlob(null);
      setManual(MANUAL_DEFAULTS);
      setManualErr({});
      setConsentSheetOpen(false);
      setConsentSheetUid(null);
      scanEnabledRef.current = null;
      ackCacheRef.current = { checked: null, uid: null };
      pendingPickerAction.current = null;
      setPickerReadyAction(null);
      setConsentJustCompleted(false);
      resumeAfterConsent.current = null;
      analysisRequestIdRef.current += 1; // invalidate any in-flight analysis
      fileRequestIdRef.current += 1; // invalidate any in-flight compression
      selectedFileOwnerUidRef.current = null;
      pickerRequestIdRef.current += 1; // invalidate any in-flight picker request
      observedAuthUidRef.current = INITIAL_AUTH_SENTINEL; // reset sentinel on close
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        setPreview(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Check scanning availability when sheet opens.
  // Consent is checked lazily when the user taps Take photo / Choose photo.
  // Camera is never triggered during this check.
  useEffect(() => {
    if (!open) return;
    if (scanEnabledRef.current !== null) {
      if (step === "status-check") {
        setStep(scanEnabledRef.current ? "pick" : "scan-unavailable");
      }
      return;
    }
    setStep("status-check");
    let cancelled = false;
    fetchScanningStatus().then((enabled) => {
      if (cancelled) return;
      scanEnabledRef.current = enabled;
      setStep(enabled ? "pick" : "scan-unavailable");
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Subscribe to auth state changes while sheet is open.
  // V4: Uses observedAuthUidRef with initial-emission sentinel.
  //   - First emission records the UID only; it must NOT override "status-check" step.
  //   - Subsequent UID changes: clear image/preview/analysis/draft + consent state;
  //     use resolveAuthSwitch (respects scanEnabledRef) to determine new step.
  // Fixes the cleanup race: if the effect is cleaned up before subscribeToAuthState
  // resolves, the returned unsubscribe function is called immediately.
  useEffect(() => {
    if (!open) return;
    let unsub: (() => void) | undefined;
    let cleanedUp = false;
    subscribeToAuthState((uid) => {
      const prev = observedAuthUidRef.current;

      if (prev === INITIAL_AUTH_SENTINEL) {
        // First emission: record UID but do NOT change step — scanner check owns step now
        observedAuthUidRef.current = uid;
        return;
      }

      // Genuine UID change (including sign-out)
      if (uid !== prev) {
        observedAuthUidRef.current = uid;

        // Clear all image/analysis state
        setBlob(null);
        setAnalysis(null);
        setDraft(null);
        setError(null);
        setIsQuota(false);
        setSaveReferencePhoto(false);
        setAddError(null);
        setPreview((prevUrl) => {
          if (prevUrl) URL.revokeObjectURL(prevUrl);
          return null;
        });

        // Clear consent + pending state
        setConsentSheetOpen(false);
        setConsentSheetUid(null);
        pendingPickerAction.current = null;
        setPickerReadyAction(null);
        setConsentJustCompleted(false);
        resumeAfterConsent.current = null;
        analysisRequestIdRef.current += 1;
        fileRequestIdRef.current += 1; // V5: invalidate in-flight compression
        selectedFileOwnerUidRef.current = null;
        pickerRequestIdRef.current += 1; // V5: invalidate in-flight picker request

        // Use resolveAuthSwitch so step respects scanner status
        const newState = resolveAuthSwitch(uid, ackCacheRef.current, scanEnabledRef.current);
        setStep(newState.step);
      }
    }).then((fn) => {
      if (cleanedUp) {
        // Effect was cleaned up before promise resolved — unsubscribe immediately
        fn();
      } else {
        unsub = fn;
      }
    });
    return () => {
      cleanedUp = true;
      unsub?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Focus name field when manual form opens
  useEffect(() => {
    if (step === "manual") {
      // brief timeout lets the DOM render first
      const t = setTimeout(() => manualNameRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [step]);

  // Keyboard: Escape closes (but not when consent sheet is handling it)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (consentSheetOpen) return; // let Radix Sheet handle Escape
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, consentSheetOpen]);

  if (!open) return null;

  // ── File selection ───────────────────────────────────────────────────
  // V5: Guards against A→B UID switches and multiple rapid file selections
  // while compression is in flight.
  //   - fileRequestIdRef: monotonic counter; stale compression results are discarded.
  //   - selectedFileOwnerUidRef: UID verified before picker was opened; file from
  //     user A must not appear after switching to user B.
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    // Capture request ID and expected owner for this file selection.
    const myFileRequestId = ++fileRequestIdRef.current;
    const expectedOwnerUid = selectedFileOwnerUidRef.current;

    // Verify the current UID still matches the picker owner before doing any work.
    const currentUidAtSelect = await getUid();
    if (fileRequestIdRef.current !== myFileRequestId) return; // superseded
    if (!currentUidAtSelect || currentUidAtSelect !== expectedOwnerUid) {
      // UID changed between picker open and file selection — discard silently.
      return;
    }

    // Show immediate preview (raw) while compression runs
    const rawUrl = URL.createObjectURL(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreview(rawUrl);
    setBlob(null);
    setAnalysis(null);
    setDraft(null);
    setError(null);
    setIsQuota(false);
    setStep("compressing");

    let compressedBlob: Blob | null = null;
    let compressedUrl: string | null = null;
    let compressionFailed = false;
    try {
      const { blob, objectUrl } = await compressImage(file);
      compressedBlob = blob;
      compressedUrl = objectUrl;
    } catch {
      compressionFailed = true;
    }

    // After compressImage resolves/rejects — verify request ID, open state and UID
    if (fileRequestIdRef.current !== myFileRequestId) {
      // Superseded by a newer selection, a UID switch or sheet close.
      // Revoke any URLs we created for this stale result.
      if (compressedUrl) URL.revokeObjectURL(compressedUrl);
      URL.revokeObjectURL(rawUrl);
      return;
    }
    if (!open) {
      if (compressedUrl) URL.revokeObjectURL(compressedUrl);
      URL.revokeObjectURL(rawUrl);
      return;
    }
    const uidAfterCompress = await getUid();
    if (fileRequestIdRef.current !== myFileRequestId) {
      if (compressedUrl) URL.revokeObjectURL(compressedUrl);
      URL.revokeObjectURL(rawUrl);
      return;
    }
    if (!uidAfterCompress || uidAfterCompress !== expectedOwnerUid) {
      // Account switched during compression — discard and revoke.
      if (compressedUrl) URL.revokeObjectURL(compressedUrl);
      URL.revokeObjectURL(rawUrl);
      return;
    }

    // Safe to update UI — this result belongs to the current user/request.
    if (compressionFailed) {
      URL.revokeObjectURL(rawUrl);
      // Keep rawUrl-based preview or fall back to file as blob
      setPreview(URL.createObjectURL(file));
      setBlob(file);
      setStep("preview");
    } else {
      URL.revokeObjectURL(rawUrl);
      setPreview(compressedUrl!);
      setBlob(compressedBlob!);
      setStep("preview");
    }
  }

  // ── Analyze ──────────────────────────────────────────────────────────
  // V4: Captures ownerUid before analysis begins; verifies after every await.
  // Uses analysisRequestIdRef so stale responses cannot update UI for another account.
  async function analyze() {
    if (!imageBlob) return;
    setError(null);
    setIsQuota(false);

    // V4: Capture analysis ownership before any async work
    const myRequestId = ++analysisRequestIdRef.current;
    const ownerUid = await getUid();
    if (analysisRequestIdRef.current !== myRequestId) return; // stale
    if (!ownerUid) {
      setStep("sign-in-required");
      return;
    }

    // Capture blob reference for ack-required recovery
    const capturedBlob = imageBlob;

    // ── Local on-device detection ───────────────────────────────────────
    // Privacy safeguard: detect faces/persons before the image leaves the device.
    // The localDetector module is lazily imported here — not in the initial bundle.
    // All assets are self-hosted under /mediapipe/ (committed to the repository).
    // Errors block the upload — detection is never silently bypassed.
    setStep("detecting");
    try {
      const bitmap = await createImageBitmap(imageBlob).catch(() => null);

      // V5: Guard after createImageBitmap — A→B switch during decoding must not
      // update B's UI with A's error/detection results.
      if (analysisRequestIdRef.current !== myRequestId) {
        bitmap?.close(); // dispose if we got one before the guard
        return;
      }

      if (!bitmap) {
        // Cannot decode image for detection — block upload
        setError("Could not process image for screening. Please try another photo.");
        setStep("error");
        return;
      }
      const offscreen = document.createElement("canvas");
      offscreen.width = bitmap.width;
      offscreen.height = bitmap.height;
      const ctx2d = offscreen.getContext("2d");
      if (!ctx2d) {
        bitmap.close(); // dispose ImageBitmap
        setError("Could not prepare image for screening. Please try again.");
        setStep("error");
        return;
      }
      ctx2d.drawImage(bitmap, 0, 0);
      bitmap.close(); // dispose ImageBitmap after drawing — not needed further

      // Dynamic import — localDetector is not in the initial bundle
      const { runLocalDetection } = await import("@/lib/localDetector");

      // V5: Guard after dynamic import (async — UID may have changed)
      if (analysisRequestIdRef.current !== myRequestId) return;

      const detection = await runLocalDetection(offscreen);
      // offscreen canvas is a temporary DOM element; no explicit cleanup needed
      // (no object URLs or persistent references held)

      // V5: Guard after runLocalDetection — person/face/error result from A must
      // not overwrite B's UI after a UID switch during detection.
      if (analysisRequestIdRef.current !== myRequestId) return;

      if (!detection.ok) {
        if (detection.reason === "face" || detection.reason === "person") {
          // Face or person detected — block before any network request to Anthropic
          setError("Please upload the clothing item by itself, without any person, face or body.");
          setStep("error");
          return;
        }
        if (detection.reason === "init_failed" || detection.reason === "inference_failed") {
          // Detector failed — never silently bypass; block and ask user to retry
          setError("Safety screening could not complete. Please try again.");
          setStep("error");
          return;
        }
      }
    } catch {
      // V5: Guard after catch — unexpected error during module load or detection
      if (analysisRequestIdRef.current !== myRequestId) return;
      // Unexpected error loading the detector module itself
      setError("Could not initialize safety screening. Please try again.");
      setStep("error");
      return;
    }

    // V4: Verify ownership after local detection completed
    if (analysisRequestIdRef.current !== myRequestId) return;
    const midUid = await getUid();
    if (analysisRequestIdRef.current !== myRequestId) return;
    if (midUid !== ownerUid) {
      // Account switched mid-detection — clear state, do not proceed
      setBlob(null);
      setPreview((url) => {
        if (url) URL.revokeObjectURL(url);
        return null;
      });
      setStep(midUid ? (scanEnabledRef.current ? "pick" : "scan-unavailable") : "sign-in-required");
      return;
    }

    // ── AI scan ────────────────────────────────────────────────────────
    setStep("analyzing");
    try {
      const result = await scanWithAI(imageBlob);

      // V4: Verify ownership after AI scan
      if (analysisRequestIdRef.current !== myRequestId) return;
      const afterScanUid = await getUid();
      if (analysisRequestIdRef.current !== myRequestId) return;
      if (afterScanUid !== ownerUid) {
        setBlob(null);
        setPreview((url) => {
          if (url) URL.revokeObjectURL(url);
          return null;
        });
        setStep(
          afterScanUid
            ? scanEnabledRef.current
              ? "pick"
              : "scan-unavailable"
            : "sign-in-required",
        );
        return;
      }

      setAnalysis(result);
      setDraft(analysisToItem(result));
      setStep("confirm");
    } catch (err) {
      if (analysisRequestIdRef.current !== myRequestId) return;

      const code =
        err instanceof Error && "code" in err ? (err as { code?: string }).code : undefined;
      setError(err instanceof Error ? err.message : "Analysis failed.");
      setIsQuota(code === "quota");

      // V4: If server returns ack-required for a stable owner UID:
      //   - preserve blob in resumeAfterConsent (user does not re-select)
      //   - verify UID is still the owner before opening consent
      if (code === "ack") {
        ackCacheRef.current = { checked: false, uid: null };
        const uid = await getUid();
        if (analysisRequestIdRef.current !== myRequestId) return;
        if (!uid) {
          setStep("sign-in-required");
          return;
        }
        if (uid !== ownerUid) {
          // Account changed during analysis — clear image, do not open consent for wrong user
          setBlob(null);
          setPreview((url) => {
            if (url) URL.revokeObjectURL(url);
            return null;
          });
          setStep(scanEnabledRef.current ? "pick" : "scan-unavailable");
          return;
        }
        // Stable owner UID — preserve blob for post-consent resume
        resumeAfterConsent.current = { uid: ownerUid, blob: capturedBlob };
        setConsentSheetUid(uid);
        setConsentSheetOpen(true);
        setStep("ack-required");
        return;
      }
      setStep("error");
    }
  }

  // ── Manual submission ────────────────────────────────────────────────
  async function submitManual() {
    const errs = validateManual(manual);
    setManualErr(errs);
    if (Object.keys(errs).length > 0) {
      // Focus the first invalid field
      manualNameRef.current?.focus();
      return;
    }
    try {
      setAddingItem(true);
      setAddError(null);
      await onAdd(manualToItem(manual));
      setStep("manual-success");
    } catch (error) {
      setAddError(error instanceof Error ? error.message : "Could not add item. Please try again.");
    } finally {
      setAddingItem(false);
    }
  }

  async function addScannedItem() {
    if (!draft || addingItem) return;
    setAddingItem(true);
    setAddError(null);

    try {
      const referencePhoto =
        saveReferencePhoto && imageBlob ? await createWardrobeThumbnail(imageBlob) : undefined;
      await onAdd({ ...draft, labels: [`${draft.warmth} warmth`, draft.style] }, referencePhoto);
      onClose();
    } catch (error) {
      setAddError(
        error instanceof Error
          ? error.message
          : "Could not save this wardrobe item. Please try again.",
      );
    } finally {
      setAddingItem(false);
    }
  }

  // ── Reset ────────────────────────────────────────────────────────────
  function reset() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreview(null);
    }
    setBlob(null);
    setAnalysis(null);
    setDraft(null);
    setError(null);
    setIsQuota(false);
    setSaveReferencePhoto(false);
    setAddingItem(false);
    setAddError(null);
    // V4/V5: clear all pending consent/picker/file state on reset
    pendingPickerAction.current = null;
    setPickerReadyAction(null);
    setConsentJustCompleted(false);
    resumeAfterConsent.current = null;
    analysisRequestIdRef.current += 1;
    fileRequestIdRef.current += 1; // V5
    selectedFileOwnerUidRef.current = null;
    pickerRequestIdRef.current += 1; // V5
    setStep("pick");
  }

  function goToManual() {
    // V4/V5: clear pending consent/picker/file state when going manual
    pendingPickerAction.current = null;
    setPickerReadyAction(null);
    setConsentJustCompleted(false);
    resumeAfterConsent.current = null;
    fileRequestIdRef.current += 1; // V5: invalidate in-flight compression
    selectedFileOwnerUidRef.current = null;
    pickerRequestIdRef.current += 1; // V5: invalidate in-flight picker request
    setManual(MANUAL_DEFAULTS);
    setManualErr({});
    setSaveReferencePhoto(false);
    setAddError(null);
    setStep("manual");
  }

  // ── Picker request (consent-guarded) ──────────────────────────────────
  // V4/V5: Uses resolvePickerRequestWith from pickerConsentLogic.ts.
  // V5: pickerRequestIdRef ensures a stale result (from before a UID change,
  // sheet close, or superseding request) cannot open consent or picker-ready
  // for the wrong account.
  async function handlePickerRequest(action: "camera" | "library") {
    const myPickerRequestId = ++pickerRequestIdRef.current;

    const result = await resolvePickerRequestWith(action, ackCacheRef.current, {
      getUid,
      checkConsent: async (uid) => {
        const res = await checkConsentStatus();
        return { uid: res.uid, acknowledged: res.acknowledged };
      },
    });

    // Discard if superseded by a newer request, UID change, sheet close, or manual entry.
    if (pickerRequestIdRef.current !== myPickerRequestId) return;

    if (result.outcome === "stale" || result.outcome === "noop") {
      // Stale: UID changed mid-flight; noop: never reached (manual not passed here).
      return;
    }

    if (result.outcome === "sign-in") {
      setStep("sign-in-required");
    } else if (result.outcome === "picker-ready") {
      // Consent already given — show existing-consent picker-ready (no "Setup complete").
      // V5: record the verified uid so the file selection can cross-check it.
      selectedFileOwnerUidRef.current = result.uid;
      setConsentJustCompleted(false);
      setPickerReadyAction(result.action);
      setStep("picker-ready");
    } else if (result.outcome === "open-consent") {
      // Need setup — remember what they wanted and open consent sheet.
      // V5: consentSheetUid is also the expected picker-owner uid for post-consent file selection.
      selectedFileOwnerUidRef.current = result.uid;
      pendingPickerAction.current = result.action;
      setConsentSheetUid(result.uid);
      setConsentSheetOpen(true);
      setStep("ack-required");
    }
  }

  // ── Title ─────────────────────────────────────────────────────────────
  const title =
    step === "status-check"
      ? "Add clothing"
      : step === "scan-unavailable"
        ? "Add clothing"
        : step === "ack-required"
          ? "Before you scan"
          : step === "picker-ready"
            ? "Ready to scan"
            : step === "sign-in-required"
              ? "Add clothing"
              : step === "manual"
                ? "Add clothing manually"
                : step === "manual-success"
                  ? "Item added"
                  : step === "confirm"
                    ? "Confirm item"
                    : step === "detecting"
                      ? "Checking photo…"
                      : step === "analyzing" || step === "compressing"
                        ? "Analyzing…"
                        : step === "error"
                          ? "Try another photo"
                          : "Add clothing";

  // ── Update a single manual field ───────────────────────────────────
  function setM<K extends keyof ManualFields>(key: K, val: ManualFields[K]) {
    setManual((prev) => {
      const next = { ...prev, [key]: val };
      // When category changes, reset garmentType to first option for new category
      if (key === "category") {
        next.garmentType = defaultGarmentType(val as WardrobeCategory);
      }
      return next;
    });
    if (manualErrors[key as keyof ManualErrors])
      setManualErr((prev) => ({ ...prev, [key]: undefined }));
  }

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed inset-0 z-[60] flex items-end justify-center"
      >
        {/* Hidden camera input */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={handleFileChange}
        />
        {/* Hidden library input */}
        <input
          ref={libraryInputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={handleFileChange}
        />

        {/* Backdrop */}
        <button
          aria-label="Close"
          onClick={onClose}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        />

        <div className="glass-card relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-b-none rounded-t-[2rem] p-5 pb-8 animate-fade-up sm:mb-6 sm:rounded-[2rem]">
          {/* Header */}
          <div className="mb-4 flex items-center justify-between">
            {/* Back button — manual form goes back to unavailable screen */}
            {step === "manual" && (
              <button
                onClick={() => setStep("scan-unavailable")}
                aria-label="Back"
                className="press mr-2 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-foreground/5 text-muted-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <h2 className="flex-1 text-lg font-semibold tracking-tight">{title}</h2>
            <button
              onClick={onClose}
              aria-label="Close add clothing"
              className="press grid h-9 w-9 place-items-center rounded-full bg-foreground/5 text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* ── STATUS CHECK ──────────────────────────────────────────── */}
          {step === "status-check" && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
              <div
                className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
                role="status"
                aria-label="Checking availability"
              />
              <p className="text-sm">Checking availability…</p>
            </div>
          )}

          {/* ── SCAN UNAVAILABLE ──────────────────────────────────────── */}
          {step === "scan-unavailable" && (
            <div className="flex flex-col gap-4">
              <div className="glass-card rounded-[1.75rem] px-6 py-8 text-center">
                <AlertCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
                <p className="font-semibold">Scanning is temporarily unavailable</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  You can still add clothing manually — it works exactly the same way.
                </p>
              </div>
              <button
                onClick={goToManual}
                className="press flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-semibold text-background"
                aria-label="Add clothing manually"
              >
                <PenLine className="h-4 w-4" />
                Add manually
              </button>
            </div>
          )}

          {/* ── MANUAL ENTRY FORM ─────────────────────────────────────── */}
          {step === "manual" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitManual();
              }}
              noValidate
              aria-label="Manual clothing entry form"
            >
              <div className="space-y-2.5">
                {/* Name */}
                <div>
                  <label
                    htmlFor="manual-name"
                    className="mb-1 block text-sm font-medium text-muted-foreground"
                  >
                    Item name{" "}
                    <span aria-hidden className="text-destructive">
                      *
                    </span>
                  </label>
                  <input
                    id="manual-name"
                    ref={manualNameRef}
                    type="text"
                    value={manual.name}
                    onChange={(e) => setM("name", e.target.value)}
                    placeholder="e.g. Navy wool overcoat"
                    maxLength={120}
                    aria-required="true"
                    aria-describedby={manualErrors.name ? "manual-name-err" : undefined}
                    aria-invalid={!!manualErrors.name}
                    className="w-full rounded-2xl bg-foreground/[0.04] px-4 py-3 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
                  />
                  {manualErrors.name && (
                    <p id="manual-name-err" role="alert" className="mt-1 text-xs text-destructive">
                      {manualErrors.name}
                    </p>
                  )}
                </div>

                {/* Category */}
                <div>
                  <label
                    htmlFor="manual-category"
                    className="mb-1 block text-sm font-medium text-muted-foreground"
                  >
                    Category{" "}
                    <span aria-hidden className="text-destructive">
                      *
                    </span>
                  </label>
                  <select
                    id="manual-category"
                    value={manual.category}
                    onChange={(e) => setM("category", e.target.value as WardrobeCategory)}
                    aria-required="true"
                    className="w-full rounded-2xl bg-foreground/[0.04] px-4 py-3 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Garment type — controls matcher token score */}
                <div>
                  <label
                    htmlFor="manual-garment-type"
                    className="mb-1 block text-sm font-medium text-muted-foreground"
                  >
                    Garment type{" "}
                    <span aria-hidden className="text-destructive">
                      *
                    </span>
                  </label>
                  <select
                    id="manual-garment-type"
                    value={manual.garmentType}
                    onChange={(e) => setM("garmentType", e.target.value)}
                    aria-required="true"
                    className="w-full rounded-2xl bg-foreground/[0.04] px-4 py-3 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
                  >
                    {GARMENT_TYPES[manual.category].map((g) => (
                      <option key={g.type} value={g.type}>
                        {g.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Colour */}
                <div>
                  <label
                    htmlFor="manual-color"
                    className="mb-1 block text-sm font-medium text-muted-foreground"
                  >
                    Primary colour{" "}
                    <span aria-hidden className="text-destructive">
                      *
                    </span>
                  </label>
                  <input
                    id="manual-color"
                    type="text"
                    value={manual.color}
                    onChange={(e) => setM("color", e.target.value)}
                    placeholder="e.g. Navy blue"
                    maxLength={60}
                    aria-required="true"
                    aria-describedby={manualErrors.color ? "manual-color-err" : undefined}
                    aria-invalid={!!manualErrors.color}
                    className="w-full rounded-2xl bg-foreground/[0.04] px-4 py-3 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
                  />
                  {manualErrors.color && (
                    <p id="manual-color-err" role="alert" className="mt-1 text-xs text-destructive">
                      {manualErrors.color}
                    </p>
                  )}
                </div>

                {/* Warmth */}
                <div>
                  <fieldset>
                    <legend className="mb-1 block text-sm font-medium text-muted-foreground">
                      Warmth
                    </legend>
                    <div className="grid grid-cols-3 gap-2">
                      {(["Light", "Medium", "Warm"] as const).map((w) => (
                        <label
                          key={w}
                          className={`flex cursor-pointer items-center justify-center rounded-2xl px-3 py-2.5 text-sm font-medium ring-1 transition-colors ${
                            manual.warmth === w
                              ? "bg-primary/15 text-primary ring-primary/30"
                              : "bg-foreground/[0.04] text-muted-foreground ring-transparent"
                          }`}
                        >
                          <input
                            type="radio"
                            name="manual-warmth"
                            value={w}
                            checked={manual.warmth === w}
                            onChange={() => setM("warmth", w)}
                            className="sr-only"
                          />
                          {w}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>

                {/* Water resistance */}
                <div>
                  <fieldset>
                    <legend className="mb-1 block text-sm font-medium text-muted-foreground">
                      Water resistance
                    </legend>
                    <div className="grid grid-cols-3 gap-2">
                      {(["Low", "Medium", "High"] as const).map((w) => (
                        <label
                          key={w}
                          className={`flex cursor-pointer items-center justify-center rounded-2xl px-3 py-2.5 text-sm font-medium ring-1 transition-colors ${
                            manual.waterResistance === w
                              ? "bg-primary/15 text-primary ring-primary/30"
                              : "bg-foreground/[0.04] text-muted-foreground ring-transparent"
                          }`}
                        >
                          <input
                            type="radio"
                            name="manual-water"
                            value={w}
                            checked={manual.waterResistance === w}
                            onChange={() => setM("waterResistance", w)}
                            className="sr-only"
                          />
                          {w}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </div>

                {/* Style — optional */}
                <div>
                  <label
                    htmlFor="manual-style"
                    className="mb-1 block text-sm font-medium text-muted-foreground"
                  >
                    Style <span className="text-muted-foreground/50 text-xs">(optional)</span>
                  </label>
                  <input
                    id="manual-style"
                    type="text"
                    value={manual.style}
                    onChange={(e) => setM("style", e.target.value)}
                    placeholder="e.g. Casual, Smart-casual, Formal"
                    maxLength={60}
                    className="w-full rounded-2xl bg-foreground/[0.04] px-4 py-3 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
                  />
                </div>
              </div>

              {/* Summary of derived values */}
              <div className="mt-4 rounded-2xl bg-foreground/[0.03] px-4 py-3 text-xs text-muted-foreground">
                <p>
                  <span className="font-medium">Weather fit: </span>
                  {deriveWeatherFit(manual.warmth, manual.waterResistance)}
                </p>
                <p className="mt-0.5">
                  <span className="font-medium">Best for: </span>
                  {deriveSeason(manual.warmth)}
                </p>
              </div>

              {/* Actions */}
              {addError && (
                <p
                  role="alert"
                  className="mt-4 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  {addError}
                </p>
              )}
              <button
                type="submit"
                disabled={addingItem}
                className="press mt-5 w-full rounded-full bg-foreground py-3.5 text-sm font-semibold text-background disabled:opacity-50"
              >
                {addingItem ? "Saving…" : "Add to wardrobe"}
              </button>
              <button
                type="button"
                onClick={() => setStep("scan-unavailable")}
                className="press mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-sm text-muted-foreground"
              >
                <ChevronLeft className="h-3.5 w-3.5" /> Back
              </button>
            </form>
          )}

          {/* ── MANUAL SUCCESS ─────────────────────────────────────────── */}
          {step === "manual-success" && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Check className="h-8 w-8" />
              </div>
              <div>
                <p className="font-semibold">Item added to your wardrobe</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  It's ready for outfit matching when you're outside.
                </p>
              </div>
              <button
                onClick={() => {
                  // Reset and go directly to fresh manual form
                  setManual(MANUAL_DEFAULTS);
                  setManualErr({});
                  setStep("manual");
                }}
                className="press rounded-full bg-foreground/[0.06] px-5 py-2.5 text-sm font-medium text-foreground"
              >
                Add another
              </button>
              <button
                onClick={onClose}
                className="press rounded-full bg-foreground px-5 py-2.5 text-sm font-semibold text-background"
              >
                Done
              </button>
            </div>
          )}

          {/* ── ACK REQUIRED ──────────────────────────────────────────── */}
          {/* Shown when the consent sheet is closed without completing setup.
            Provides both a path to reopen consent AND manual entry — so the
            user is never stranded (item 2). */}
          {step === "ack-required" && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                One quick setup step before you can scan.
              </p>
              <button
                onClick={() => {
                  if (consentSheetUid) setConsentSheetOpen(true);
                }}
                className="press flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-semibold text-background"
                aria-label="Set up AI scan"
              >
                Set up AI scan
              </button>
              <button
                onClick={goToManual}
                className="press flex items-center justify-center gap-1.5 rounded-full py-2.5 text-sm text-muted-foreground"
              >
                <PenLine className="h-3.5 w-3.5" aria-hidden /> Add manually instead
              </button>
            </div>
          )}

          {/* ── PICKER READY ──────────────────────────────────────────── */}
          {/* Shown after consent setup completes OR when user taps Take/Choose photo
            and consent was already valid. Renders a fresh synchronous button so
            input.click() is always called from a real user gesture (item 1).
            V4 Item 8: wording differs by path:
              - consentJustCompleted=true  → "Setup complete — you're ready to scan"
              - consentJustCompleted=false → "Ready to open your camera/photo library" */}
          {step === "picker-ready" && pickerReadyAction && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Check className="h-7 w-7" strokeWidth={1.8} />
              </div>
              {consentJustCompleted ? (
                <p className="font-semibold">Setup complete — you&rsquo;re ready to scan</p>
              ) : (
                <p className="font-semibold">
                  {pickerReadyAction === "camera"
                    ? "Ready to open your camera"
                    : "Ready to choose a photo"}
                </p>
              )}
              <p className="text-sm text-muted-foreground">
                Tap below to open your {pickerReadyAction === "camera" ? "camera" : "photo library"}
                .
              </p>
              <button
                onClick={() => {
                  // This is the ONLY place that may call input.click() for the
                  // picker-ready flow — it runs synchronously from a fresh user tap.
                  // V5.1: no await before click() — required for synchronous iOS picker
                  // activation. Ownership is secure because:
                  //   - selectedFileOwnerUidRef was set from the verified picker result;
                  //   - auth changes clear pickerReadyAction and increment request IDs;
                  //   - handleFileChange verifies UID against selectedFileOwnerUidRef
                  //     before use and again after compression.
                  const action = pickerReadyAction;
                  const expectedOwner = selectedFileOwnerUidRef.current;

                  if (!action || !expectedOwner) {
                    setPickerReadyAction(null);
                    setConsentJustCompleted(false);
                    setStep("sign-in-required");
                    return;
                  }

                  setPickerReadyAction(null);
                  setConsentJustCompleted(false);
                  setStep("pick");

                  if (action === "camera") {
                    cameraInputRef.current?.click();
                  } else {
                    libraryInputRef.current?.click();
                  }
                }}
                className="press flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-semibold text-background"
                aria-label={pickerReadyAction === "camera" ? "Open camera" : "Choose from library"}
              >
                {pickerReadyAction === "camera" ? (
                  <>
                    <Camera className="h-4 w-4" aria-hidden /> Open camera
                  </>
                ) : (
                  <>
                    <ImageIcon className="h-4 w-4" aria-hidden /> Choose from library
                  </>
                )}
              </button>
              <button
                onClick={() => {
                  setPickerReadyAction(null);
                  setConsentJustCompleted(false);
                  goToManual();
                }}
                className="press flex items-center justify-center gap-1.5 rounded-full py-2.5 text-sm text-muted-foreground"
              >
                <PenLine className="h-3.5 w-3.5" aria-hidden /> Add manually instead
              </button>
            </div>
          )}

          {/* ── SIGN-IN REQUIRED ──────────────────────────────────────── */}
          {step === "sign-in-required" && (
            <div className="flex flex-col items-center gap-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Please sign in to use AI clothing scan.
              </p>
              <button
                onClick={goToManual}
                className="press flex items-center justify-center gap-1.5 rounded-full py-2.5 text-sm text-muted-foreground"
              >
                <PenLine className="h-3.5 w-3.5" aria-hidden /> Add manually instead
              </button>
            </div>
          )}

          {/* ── PICK ──────────────────────────────────────────────────── */}
          {step === "pick" && (
            <div>
              <div className="glass-card flex flex-col items-center gap-3 rounded-[1.75rem] px-6 py-10 text-center">
                <div className="grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary">
                  <Camera className="h-7 w-7" strokeWidth={1.6} />
                </div>
                <p className="font-semibold">Add something from your closet</p>
                <p className="max-w-xs text-sm text-muted-foreground">
                  Snap a photo or choose from your library and Aeruvo will fill in the details for
                  you.
                </p>
              </div>
              {/* Inline safety reminder — shown after consent is complete */}
              <p
                className="mt-3 text-center text-xs text-muted-foreground"
                aria-label="Photo reminder"
              >
                One clothing item · No people or personal details
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <button
                  onClick={() => handlePickerRequest("camera")}
                  className="press flex items-center justify-center gap-2 rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-background"
                  aria-label="Take a photo with camera"
                >
                  <Camera className="h-4 w-4" /> Take photo
                </button>
                <button
                  onClick={() => handlePickerRequest("library")}
                  className="press glass-card flex items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold"
                  aria-label="Choose a photo from library"
                >
                  <ImageIcon className="h-4 w-4" /> Choose photo
                </button>
              </div>
            </div>
          )}

          {/* ── PREVIEW / COMPRESSING ─────────────────────────────────── */}
          {(step === "preview" || step === "compressing") && previewUrl && (
            <div className="flex flex-col gap-4">
              <div className="relative overflow-hidden rounded-[1.75rem]">
                <img
                  src={previewUrl}
                  alt="Selected clothing item"
                  className="h-64 w-full object-cover"
                />
                {step === "compressing" && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                    <p className="text-sm font-medium text-white">Preparing…</p>
                  </div>
                )}
              </div>
              {step === "preview" && (
                <>
                  {/* V4 Item 5: After ack-required consent recovery, show "Continue analysis"
                    instead of "Analyze with AI" to make the flow clear. */}
                  {consentJustCompleted ? (
                    <>
                      <p className="text-center text-sm font-medium text-primary">
                        Setup complete — tap below to continue.
                      </p>
                      <button
                        onClick={() => {
                          setConsentJustCompleted(false);
                          analyze();
                        }}
                        disabled={!imageBlob}
                        className="press flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-semibold text-background disabled:opacity-50"
                      >
                        <Sparkles className="h-4 w-4" /> Continue analysis
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={analyze}
                      disabled={!imageBlob}
                      className="press flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-semibold text-background disabled:opacity-50"
                    >
                      <Sparkles className="h-4 w-4" /> Analyze with AI
                    </button>
                  )}
                  {/* ── AI disclosure (required before any scan) ─────────── */}
                  <p className="mt-1 text-center text-xs text-muted-foreground">
                    Your garment photo will be analyzed by Anthropic's Claude AI. Do not upload
                    people, faces, bodies, identification documents or personal information.{" "}
                    <a href="/privacy" className="underline underline-offset-2">
                      Privacy Policy
                    </a>
                  </p>
                  <button
                    onClick={reset}
                    className="press flex items-center justify-center gap-1.5 text-sm text-muted-foreground"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> Choose another photo
                  </button>
                </>
              )}
            </div>
          )}

          {/* ── DETECTING ─────────────────────────────────────────────── */}
          {step === "detecting" && (
            <div
              className="flex flex-col items-center gap-4 py-6 text-center"
              role="status"
              aria-live="polite"
            >
              {previewUrl && (
                <div className="relative overflow-hidden rounded-[1.75rem]">
                  <img src={previewUrl} alt="Checking photo" className="h-48 w-48 object-cover" />
                  <div
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-0 h-2 animate-pulse bg-primary/30"
                  />
                </div>
              )}
              <p className="flex items-center gap-2 font-medium">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
                Checking photo…
              </p>
              <p className="text-sm text-muted-foreground">Screening for privacy before upload.</p>
            </div>
          )}

          {/* ── ANALYZING ─────────────────────────────────────────────── */}
          {step === "analyzing" && (
            <div
              className="flex flex-col items-center gap-4 py-6 text-center"
              role="status"
              aria-live="polite"
            >
              {previewUrl && (
                <div className="relative overflow-hidden rounded-[1.75rem]">
                  <img src={previewUrl} alt="Analyzing" className="h-48 w-48 object-cover" />
                  <div
                    aria-hidden
                    className="scan-sweep pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-primary/35 to-transparent"
                  />
                </div>
              )}
              <p className="flex items-center gap-2 font-medium">
                <Sparkles className="h-4 w-4 text-primary" /> Analyzing your item…
              </p>
              <p className="text-sm text-muted-foreground">
                Reading colour, fabric weight, and warmth.
              </p>
            </div>
          )}

          {/* ── ERROR ─────────────────────────────────────────────────── */}
          {step === "error" && (
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <div className="grid h-16 w-16 place-items-center rounded-2xl bg-destructive/10 text-destructive">
                <AlertCircle className="h-7 w-7" />
              </div>
              <p className="font-semibold text-destructive">
                {isQuotaError ? "Scan limit reached" : "We couldn't analyze this item"}
              </p>
              <p className="max-w-xs text-sm text-muted-foreground">{error}</p>
              {!isQuotaError && (
                <button
                  onClick={reset}
                  className="press flex items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-semibold text-background"
                >
                  <RefreshCw className="h-4 w-4" /> Try another photo
                </button>
              )}
              {isQuotaError && (
                <a
                  href="/premium"
                  className="press flex items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-semibold text-background"
                >
                  <Sparkles className="h-4 w-4" /> Upgrade to Premium
                </a>
              )}
            </div>
          )}

          {/* ── AI CONFIRM ────────────────────────────────────────────── */}
          {step === "confirm" && draft && analysis && (
            <div>
              <div className="flex items-start gap-4">
                {previewUrl && (
                  <img
                    src={previewUrl}
                    alt={draft.name}
                    className="h-24 w-24 shrink-0 rounded-2xl object-cover"
                  />
                )}
                <div>
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-primary">
                    <Check className="h-3.5 w-3.5" /> Aeruvo analyzed this item
                  </p>
                  <p className="mt-1 text-lg font-semibold leading-tight">{draft.name}</p>
                  <p className="text-sm text-muted-foreground">{draft.type}</p>
                  {/* evidence field intentionally omitted — not returned by new scans (decision a) */}
                </div>
              </div>

              <div className="mt-5 space-y-2.5">
                <Field label="Item" estimated={false}>
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    aria-label="Item name"
                    className="w-full bg-transparent text-right text-sm font-medium outline-none"
                  />
                </Field>
                <Field
                  label="Category"
                  estimated={analysis.confidence.category < CONFIDENCE_THRESHOLD}
                >
                  <select
                    value={draft.category}
                    onChange={(e) =>
                      setDraft({ ...draft, category: e.target.value as WardrobeCategory })
                    }
                    aria-label="Category"
                    className="bg-transparent text-right text-sm font-medium outline-none"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Color" estimated={analysis.confidence.color < CONFIDENCE_THRESHOLD}>
                  <input
                    value={draft.color}
                    onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                    aria-label="Color"
                    className="w-full bg-transparent text-right text-sm font-medium outline-none"
                  />
                </Field>
                <Field label="Warmth" estimated={analysis.confidence.warmth < CONFIDENCE_THRESHOLD}>
                  <select
                    value={draft.warmth}
                    onChange={(e) =>
                      setDraft({ ...draft, warmth: e.target.value as WardrobeItem["warmth"] })
                    }
                    aria-label="Warmth"
                    className="bg-transparent text-right text-sm font-medium outline-none"
                  >
                    {(["Light", "Medium", "Warm"] as const).map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Weather fit" estimated={false}>
                  <input
                    value={draft.weatherFit}
                    onChange={(e) => setDraft({ ...draft, weatherFit: e.target.value })}
                    aria-label="Weather fit"
                    className="w-full bg-transparent text-right text-sm font-medium outline-none"
                  />
                </Field>
                <Field
                  label="Water resistance"
                  estimated={analysis.confidence.waterResistance < CONFIDENCE_THRESHOLD}
                >
                  <select
                    value={draft.waterResistance}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        waterResistance: e.target.value as WardrobeItem["waterResistance"],
                      })
                    }
                    aria-label="Water resistance"
                    className="bg-transparent text-right text-sm font-medium outline-none"
                  >
                    {(["Low", "Medium", "High"] as const).map((w) => (
                      <option key={w} value={w}>
                        {w}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Style" estimated={analysis.confidence.style < CONFIDENCE_THRESHOLD}>
                  <input
                    value={draft.style}
                    onChange={(e) => setDraft({ ...draft, style: e.target.value })}
                    aria-label="Style"
                    className="w-full bg-transparent text-right text-sm font-medium outline-none"
                  />
                </Field>
                <Field label="Season" estimated={false}>
                  <input
                    value={draft.season}
                    onChange={(e) => setDraft({ ...draft, season: e.target.value })}
                    aria-label="Season"
                    className="w-full bg-transparent text-right text-sm font-medium outline-none"
                  />
                </Field>
              </div>

              <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl bg-primary/[0.06] px-4 py-3 ring-1 ring-primary/15">
                <input
                  type="checkbox"
                  checked={saveReferencePhoto}
                  onChange={(event) => setSaveReferencePhoto(event.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-border accent-primary"
                />
                <span>
                  <span className="block text-sm font-medium">
                    Save a reference photo on this device
                  </span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                    Optional. Aeruvo saves a small cleaned thumbnail locally so recommendations can
                    show this exact item. The original photo and location metadata are not saved,
                    and the thumbnail is not uploaded to Aeruvo or Firebase.
                  </span>
                </span>
              </label>

              {addError && (
                <p
                  role="alert"
                  className="mt-3 rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive"
                >
                  {addError}
                </p>
              )}

              <button
                onClick={addScannedItem}
                disabled={addingItem}
                className="press mt-5 w-full rounded-full bg-foreground px-5 py-3.5 text-sm font-semibold text-background disabled:opacity-50"
              >
                {addingItem ? "Saving…" : "Add to wardrobe"}
              </button>
              <button
                onClick={reset}
                className="press mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-sm text-muted-foreground"
              >
                <RefreshCw className="h-3.5 w-3.5" /> Scan again
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── SCAN CONSENT SHEET ─────────────────────────────────────────────
        Rendered at root level (outside the glass card) so it overlays
        the AddClothingSheet correctly. Shown on first scan per UID.
        key={consentSheetUid} resets all ScanConsentSheet state when
        the uid changes (item 3). */}
      <ScanConsentSheet
        key={consentSheetUid ?? ""}
        open={consentSheetOpen}
        uid={consentSheetUid ?? ""}
        onComplete={async () => {
          setConsentSheetOpen(false);

          // V4 Item 6: verify current UID equals consentSheetUid before updating cache
          const verifiedUid = await getUid();
          if (!verifiedUid || verifiedUid !== consentSheetUid) {
            // Account changed during consent flow — do not proceed
            return;
          }

          // V4 Item 6: set BOTH ackCacheRef fields (ownership + status)
          ackCacheRef.current = { checked: true, uid: verifiedUid };

          // V4 Item 5: Check for resumeAfterConsent (ack-required mid-analysis recovery)
          const resume = resumeAfterConsent.current;
          if (resume && resume.uid === verifiedUid) {
            // Restore the preserved blob and return to preview for "Continue analysis"
            resumeAfterConsent.current = null;
            pendingPickerAction.current = null;
            selectedFileOwnerUidRef.current = verifiedUid; // V5: owner for any re-attempt
            setConsentJustCompleted(true);
            setBlob(resume.blob);
            setStep("preview");
            return;
          }

          // Normal post-consent flow: show picker-ready with "Setup complete" wording
          const action = pendingPickerAction.current;
          pendingPickerAction.current = null;
          resumeAfterConsent.current = null;
          // V4 Item 8: newly-completed setup → use "Setup complete" wording
          setConsentJustCompleted(true);
          // V5: Set picker owner so the subsequent file selection can verify it.
          selectedFileOwnerUidRef.current = verifiedUid;
          // Do NOT call input.click() here — this runs in async context (after server ack).
          // Use resolveConsentComplete for picker-ready state transition.
          if (action) {
            const { pickerReadyAction: newAction, step: newStep } = resolveConsentComplete(
              action,
              ackCacheRef.current,
              verifiedUid,
            );
            setPickerReadyAction(newAction);
            setStep(newStep);
          } else {
            setStep("pick");
          }
        }}
        onManual={() => {
          setConsentSheetOpen(false);
          setConsentSheetUid(null);
          pendingPickerAction.current = null;
          setPickerReadyAction(null);
          setConsentJustCompleted(false);
          resumeAfterConsent.current = null;
          goToManual();
        }}
        onClose={() => {
          // Dismissed — stay on ack-required where user can reopen (item 2)
          setConsentSheetOpen(false);
          // Do NOT clear consentSheetUid: needed so "Set up AI scan" can reopen
        }}
      />
    </>
  );
}

/** Field row with optional "Estimated" badge for low-confidence AI values. */
function Field({
  label,
  children,
  estimated,
}: {
  label: string;
  children: React.ReactNode;
  estimated: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-2xl bg-foreground/[0.04] px-4 py-3">
      <div className="flex shrink-0 flex-col gap-0.5">
        <span className="text-sm text-muted-foreground">{label}</span>
        {estimated && (
          <span className="text-[10px] font-medium text-primary/60 uppercase tracking-wider">
            Estimated
          </span>
        )}
      </div>
      <span className="min-w-0 flex-1 text-right">{children}</span>
    </label>
  );
}
