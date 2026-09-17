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
 *   - Image bytes not persisted after session.
 *   - AI provider API key never in client bundle.
 */

import { useEffect, useRef, useState } from "react";
import {
  Camera, ImageIcon, X, Sparkles, Check, AlertCircle,
  RefreshCw, PenLine, ChevronLeft,
} from "lucide-react";
import { CATEGORIES, type WardrobeItem, type WardrobeCategory } from "./wardrobeData";

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
    { label: "T-shirt",          type: "T-shirt" },          // token: t-shirt
    { label: "Polo shirt",        type: "Polo shirt" },        // token: polo
    { label: "Long-sleeve shirt", type: "Long-sleeve shirt" }, // token: long-sleeve
    { label: "Hoodie",            type: "Hoodie" },            // token: hoodie
    { label: "Sweater",           type: "Sweater" },           // token: sweater
    { label: "Cardigan",          type: "Cardigan" },          // token: cardigan
    { label: "Fleece",            type: "Fleece" },            // token: fleece
    { label: "Blouse",            type: "Blouse" },            // token: blouse
    { label: "Turtleneck",        type: "Turtleneck" },        // token: turtleneck (women's slot)
    { label: "Tank top",          type: "Tank top" },          // token: tank
    { label: "Linen shirt",       type: "Linen shirt" },       // token: linen
  ],
  Bottoms: [
    { label: "Jeans",             type: "Jeans" },             // token: jeans
    { label: "Chinos",            type: "Chinos" },            // token: chinos
    { label: "Shorts",            type: "Shorts" },            // token: shorts
    { label: "Trousers",          type: "Trousers" },          // token: trousers
    { label: "Leggings",          type: "Leggings" },          // token: leggings
    { label: "Skirt",             type: "Skirt" },             // token: skirt
    { label: "Thermal pants",     type: "Thermal pants" },     // token: thermal
  ],
  Outerwear: [
    // "Waterproof jacket" and "Waterproof shell" are safe: Shoes compat rule
    // blocks cross-category collisions for these slots.
    { label: "Jacket",            type: "Jacket" },            // token: jacket
    { label: "Coat",              type: "Coat" },              // token: coat
    { label: "Parka",             type: "Parka" },             // token: parka
    { label: "Waterproof jacket", type: "Waterproof jacket" }, // tokens: waterproof, jacket
    { label: "Windbreaker",       type: "Windbreaker" },       // token: windbreaker
    { label: "Fleece jacket",     type: "Fleece jacket" },     // tokens: fleece, jacket
    { label: "Puffer jacket",     type: "Puffer jacket" },     // token: jacket
    { label: "Waterproof shell",  type: "Waterproof shell" },  // tokens: waterproof, shell
  ],
  Shoes: [
    // IMPORTANT: Do NOT use "Waterproof boots" as the type string.
    // "waterproof" is not protected by the Shoes compat rule on Outerwear-guessed slots.
    // Use base type "Boots" and express waterproofing via waterResistance=High.
    { label: "Sneakers",          type: "Sneakers" },          // token: sneakers
    { label: "Boots",             type: "Boots" },             // token: boots
    { label: "Ankle boots",       type: "Ankle boots" },       // token: ankle → boots
    { label: "Sandals",           type: "Sandals" },           // token: sandals
    { label: "Waterproof boots",  type: "Boots" },             // type=Boots (safe); waterResistance=High
  ],
  Accessories: [
    // Accessories cannot be matched by the wardrobe engine: all accessory-containing
    // slots ("Beanie & scarf", "Sun hat", "Wool socks") are filtered by skipKeywords
    // in matchWardrobeToOutfit. Items in this category appear in the wardrobe catalogue
    // but will not appear in Today's picks or outfit slot matches.
    { label: "Scarf",             type: "Scarf" },
    { label: "Beanie",            type: "Beanie" },
    { label: "Gloves",            type: "Gloves" },
  ],
};

/** Return the first garment type for this category (for default). */
function defaultGarmentType(cat: WardrobeCategory): string {
  return GARMENT_TYPES[cat][0]?.type ?? cat;
}
import type { ClothingAnalysis, ScanStep, ScannerAgeBand } from "@/lib/wardrobe-types";
import { SCANNER_ACK_VERSION } from "@/lib/wardrobe-types";
import { getFirebaseAuth } from "@/lib/firebase";

// ── Constants ──────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.60; // below this → show "Estimated" badge

// ── Image compression ──────────────────────────────────────────────────────

const MAX_DIMENSION = 1400;
const JPEG_QUALITY  = 0.82;

async function compressImage(file: File): Promise<{ blob: Blob; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const img    = new Image();
    const rawUrl = URL.createObjectURL(file);

    img.onload = () => {
      try {
        let { width, height } = img;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
          width  = Math.round(width  * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width  = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("Canvas unavailable")); return; }
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(rawUrl);
            if (!blob) { reject(new Error("Canvas encode failed")); return; }
            resolve({ blob, objectUrl: URL.createObjectURL(blob) });
          },
          "image/jpeg",
          JPEG_QUALITY,
        );
      } catch (err) { URL.revokeObjectURL(rawUrl); reject(err); }
    };
    img.onerror = () => { URL.revokeObjectURL(rawUrl); reject(new Error("Could not decode image")); };
    img.src = rawUrl;
  });
}

// ── Scanner acknowledgement API ───────────────────────────────────────────

/**
 * Check whether the current user has completed the scanner acknowledgement.
 */
async function fetchAckStatus(): Promise<boolean> {
  try {
    const auth = await getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) return false;
    const idToken = await user.getIdToken();
    const res = await fetch("/api/wardrobe/ack-status", {
      headers: { "Authorization": `Bearer ${idToken}` },
    });
    if (!res.ok) return false;
    const data = await res.json() as { acknowledged?: boolean };
    return data.acknowledged === true;
  } catch {
    return false;
  }
}

/**
 * Submit the scanner acknowledgement to the server.
 */
async function submitAcknowledgement(
  ageBand: ScannerAgeBand,
  guardianPermissionConfirmed: boolean,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const auth = await getFirebaseAuth();
    const user = auth?.currentUser;
    if (!user) return { ok: false, error: "Please sign in to continue." };
    const idToken = await user.getIdToken();
    const res = await fetch("/api/wardrobe/acknowledge", {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${idToken}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({ ageBand, guardianPermissionConfirmed }),
    });
    const data = await res.json() as { ok: boolean; error?: string };
    return data;
  } catch {
    return { ok: false, error: "Could not save acknowledgement. Please try again." };
  }
}

// ── Wardrobe scanning status ───────────────────────────────────────────────

/**
 * Check whether AI wardrobe scanning is currently enabled.
 * Returns false on any error (fail-closed — avoids camera prompt when uncertain).
 * Result is cached per sheet session via the ref in the component.
 */
async function fetchScanningStatus(): Promise<boolean> {
  try {
    const res  = await fetch("/api/wardrobe/status");
    if (!res.ok) return false;
    const data = await res.json() as { scanningEnabled?: boolean };
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
    method:  "POST",
    headers: {
      "Authorization":  `Bearer ${idToken}`,
      "Content-Type":   blob.type || "image/jpeg",
      "Content-Length": String(blob.size),
    },
    body: blob,
  });

  const data = await res.json() as {
    ok: boolean; analysis?: ClothingAnalysis; error?: string; code?: string;
  };

  if (!data.ok) {
    const msg = data.error ?? "Analysis failed. Please try another photo.";
    if (data.code === "quota")  throw Object.assign(new Error(msg), { code: "quota" });
    if (data.code === "ack")    throw Object.assign(new Error(msg), { code: "ack" });
    if (data.code === "abuse")  throw Object.assign(new Error(msg), { code: "abuse" });
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
    tops: "Tops", bottoms: "Bottoms", outerwear: "Outerwear",
    shoes: "Shoes", accessories: "Accessories", dress: "Tops", other: "Tops",
  };
  const category = categoryMap[a.category] ?? "Tops";

  const warmthMap: Record<string, "Light" | "Medium" | "Warm"> = {
    "very-light": "Light", "light": "Light",
    "medium": "Medium",
    "warm": "Warm", "very-warm": "Warm",
  };
  const warmth = warmthMap[a.warmth.label] ?? "Medium";

  const waterMap: Record<string, "Low" | "Medium" | "High"> = {
    none: "Low", low: "Low", unknown: "Low", medium: "Medium", high: "High",
  };
  const waterResistance = waterMap[a.waterResistance] ?? "Low";

  const tint       = colourToTint(a.primaryColor);
  const weatherFit = a.weatherFit.join(" / ") || "All weather";
  const style      = a.styles[0] ?? "Casual";
  const season     = a.seasons.join(" / ") || "All season";
  const typeParts  = [category, a.subcategory].filter(Boolean);

  return {
    name: a.name, category, type: typeParts.join(" / "),
    color: a.primaryColor, warmth, weatherFit, waterResistance,
    style, season, labels: [`${warmth} warmth`, style],
    tint, aiAnalysis: a,
  } as Omit<WardrobeItem, "id">;
}

function colourToTint(colour: string): string {
  const c = colour.toLowerCase();
  if (c.includes("black") || c.includes("charcoal"))   return "from-slate-700/70 to-slate-900/80";
  if (c.includes("white") || c.includes("cream"))      return "from-white/80 to-slate-200/70";
  if (c.includes("navy") || c.includes("dark blue"))   return "from-blue-800/70 to-indigo-950/80";
  if (c.includes("blue"))                               return "from-sky-500/60 to-blue-800/70";
  if (c.includes("grey") || c.includes("gray"))        return "from-zinc-400/60 to-zinc-700/70";
  if (c.includes("red") || c.includes("crimson"))      return "from-red-500/60 to-red-800/70";
  if (c.includes("green") || c.includes("olive"))      return "from-green-700/60 to-emerald-900/70";
  if (c.includes("brown") || c.includes("tan") || c.includes("camel")) return "from-amber-700/60 to-stone-800/70";
  if (c.includes("beige") || c.includes("sand"))       return "from-amber-200/70 to-stone-400/70";
  if (c.includes("yellow") || c.includes("mustard"))   return "from-yellow-400/60 to-amber-600/70";
  if (c.includes("pink") || c.includes("rose"))        return "from-pink-400/60 to-rose-600/70";
  if (c.includes("purple") || c.includes("violet"))    return "from-purple-500/60 to-violet-800/70";
  if (c.includes("orange"))                             return "from-orange-400/60 to-orange-700/70";
  return "from-slate-500/60 to-slate-700/70";
}

// ── Manual entry helpers ───────────────────────────────────────────────────

/**
 * Derive weatherFit deterministically from warmth + waterResistance.
 * Used for manual entries. Maps to the same strings the AI produces so the
 * wardrobe matcher's weatherFit scoring (+10) works correctly.
 */
function deriveWeatherFit(
  warmth:          "Light" | "Medium" | "Warm",
  waterResistance: "Low" | "Medium" | "High",
): string {
  const rain = waterResistance === "High" ? " / rain" :
               waterResistance === "Medium" ? " / light rain" : "";
  if (warmth === "Light")  return `Mild / warm${rain}`;
  if (warmth === "Medium") return `Cool / mild${rain}`;
  return `Cold${rain}`;
}

/**
 * Derive season deterministically from warmth.
 * Matches the strings the AI produces so the season scoring (+10) works.
 */
function deriveSeason(warmth: "Light" | "Medium" | "Warm"): string {
  if (warmth === "Light")  return "Spring / Summer";
  if (warmth === "Warm")   return "Fall / Winter";
  return "All season";
}

// ── Manual form state shape ────────────────────────────────────────────────

interface ManualFields {
  name:            string;
  category:        WardrobeCategory;
  garmentType:     string;   // controlled vocabulary — drives matcher +40 score
  color:           string;
  warmth:          "Light" | "Medium" | "Warm";
  waterResistance: "Low" | "Medium" | "High";
  style:           string;
}

const MANUAL_DEFAULTS: ManualFields = {
  name:            "",
  category:        "Tops",
  garmentType:     "T-shirt",   // first entry for Tops
  color:           "",
  warmth:          "Medium",
  waterResistance: "Low",
  style:           "Casual",
};

interface ManualErrors {
  name?:     string;
  category?: string;
  color?:    string;
}

function validateManual(f: ManualFields): ManualErrors {
  const e: ManualErrors = {};
  if (!f.name.trim())  e.name     = "Item name is required.";
  if (!f.category)     e.category = "Category is required.";
  if (!f.color.trim()) e.color    = "Colour is required.";
  return e;
}

function manualToItem(f: ManualFields): Omit<WardrobeItem, "id"> {
  const weatherFit = deriveWeatherFit(f.warmth, f.waterResistance);
  const season     = deriveSeason(f.warmth);
  const tint       = colourToTint(f.color);
  // type uses the CONTROLLED garment type (not the user name) so the
  // wardrobe matcher can reliably award the +40 type-hit score.
  // item.name is the user-facing label and drives the separate +35 score.
  const type       = f.garmentType;
  return {
    name:            f.name.trim(),
    category:        f.category,
    type,
    color:           f.color.trim(),
    warmth:          f.warmth,
    weatherFit,
    waterResistance: f.waterResistance,
    style:           f.style || "Casual",
    season,
    tint,
    labels:          [`${f.warmth} warmth`, f.style || "Casual"],
    // No aiAnalysis — this is a manual entry
  };
}

// ── Component ──────────────────────────────────────────────────────────────

export function AddClothingSheet({
  open,
  onClose,
  onAdd,
}: {
  open:    boolean;
  onClose: () => void;
  onAdd:   (item: Omit<WardrobeItem, "id">) => void;
}) {
  const [step, setStep]         = useState<ScanStep>("pick");
  const [previewUrl, setPreview] = useState<string | null>(null);
  const [imageBlob, setBlob]    = useState<Blob | null>(null);
  const [analysis, setAnalysis] = useState<ClothingAnalysis | null>(null);
  const [draft, setDraft]       = useState<Omit<WardrobeItem, "id"> | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [isQuotaError, setIsQuota] = useState(false);

  // Scanner acknowledgement state
  const [ackAgeBand,       setAckAgeBand]       = useState<ScannerAgeBand | null>(null);
  const [ackGuardian,      setAckGuardian]       = useState(false);
  const [ackAllItems,      setAckAllItems]       = useState(false);
  const [ackSubmitting,    setAckSubmitting]     = useState(false);
  const [ackError,         setAckError]          = useState<string | null>(null);
  const ackCheckedRef = useRef<boolean | null>(null); // cached per session

  // Manual entry form
  const [manual, setManual]         = useState<ManualFields>(MANUAL_DEFAULTS);
  const [manualErrors, setManualErr] = useState<ManualErrors>({});
  const manualNameRef               = useRef<HTMLInputElement>(null);

  // Scanning availability — checked once per sheet session on open.
  const scanEnabledRef = useRef<boolean | null>(null);

  // Hidden file inputs
  const cameraInputRef  = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [previewUrl]);

  // Reset all state when sheet closes
  useEffect(() => {
    if (!open) {
      setStep("pick");
      setAnalysis(null);
      setDraft(null);
      setError(null);
      setIsQuota(false);
      setBlob(null);
      setManual(MANUAL_DEFAULTS);
      setManualErr({});
      setAckAgeBand(null);
      setAckGuardian(false);
      setAckAllItems(false);
      setAckSubmitting(false);
      setAckError(null);
      scanEnabledRef.current = null;
      ackCheckedRef.current  = null;
      if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreview(null); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Check scanning availability (and ack status) when sheet opens.
  // Camera is never triggered during this check.
  useEffect(() => {
    if (!open) return;
    if (scanEnabledRef.current !== null) {
      if (step === "status-check") {
        if (!scanEnabledRef.current) { setStep("scan-unavailable"); return; }
        // If scanning enabled but ack not yet checked, check now
        if (ackCheckedRef.current === null) {
          let cancelled = false;
          fetchAckStatus().then((acknowledged) => {
            if (cancelled) return;
            ackCheckedRef.current = acknowledged;
            setStep(acknowledged ? "pick" : "ack-required");
          });
          return () => { cancelled = true; };
        }
        setStep(ackCheckedRef.current ? "pick" : "ack-required");
      }
      return;
    }
    setStep("status-check");
    let cancelled = false;
    fetchScanningStatus().then((enabled) => {
      if (cancelled) return;
      scanEnabledRef.current = enabled;
      if (!enabled) { setStep("scan-unavailable"); return; }
      // Scanning is enabled — check ack status
      fetchAckStatus().then((acknowledged) => {
        if (cancelled) return;
        ackCheckedRef.current = acknowledged;
        setStep(acknowledged ? "pick" : "ack-required");
      });
    });
    return () => { cancelled = true; };
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

  // Keyboard: Escape closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // ── File selection ───────────────────────────────────────────────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const rawUrl = URL.createObjectURL(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreview(rawUrl);
    setBlob(null);
    setAnalysis(null);
    setDraft(null);
    setError(null);
    setIsQuota(false);
    setStep("preview");
    try {
      setStep("compressing");
      const { blob, objectUrl } = await compressImage(file);
      URL.revokeObjectURL(rawUrl);
      setPreview(objectUrl);
      setBlob(blob);
      setStep("preview");
    } catch {
      setBlob(file);
      setStep("preview");
    }
  }

  // ── Analyze ──────────────────────────────────────────────────────────
  async function analyze() {
    if (!imageBlob) return;
    setError(null);
    setIsQuota(false);

    // ── Local on-device detection ───────────────────────────────────────
    // Privacy safeguard: detect faces/persons before the image leaves the device.
    // The localDetector module is lazily imported here — not in the initial bundle.
    // All assets are self-hosted under /mediapipe/ (committed to the repository).
    // Errors block the upload — detection is never silently bypassed.
    setStep("detecting");
    try {
      const bitmap = await createImageBitmap(imageBlob).catch(() => null);
      if (!bitmap) {
        // Cannot decode image for detection — block upload
        setError("Could not process image for screening. Please try another photo.");
        setStep("error");
        return;
      }
      const offscreen = document.createElement("canvas");
      offscreen.width  = bitmap.width;
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
      const detection = await runLocalDetection(offscreen);
      // offscreen canvas is a temporary DOM element; no explicit cleanup needed
      // (no object URLs or persistent references held)

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
      // Unexpected error loading the detector module itself
      setError("Could not initialize safety screening. Please try again.");
      setStep("error");
      return;
    }

    // ── AI scan ────────────────────────────────────────────────────────
    setStep("analyzing");
    try {
      const result = await scanWithAI(imageBlob);
      setAnalysis(result);
      setDraft(analysisToItem(result));
      setStep("confirm");
    } catch (err) {
      const code = err instanceof Error && "code" in err
        ? (err as { code?: string }).code : undefined;
      setError(err instanceof Error ? err.message : "Analysis failed.");
      setIsQuota(code === "quota");
      // If server returns ack-required, show the ack step (user may have cleared session)
      if (code === "ack") { ackCheckedRef.current = false; setStep("ack-required"); return; }
      setStep("error");
    }
  }

  // ── Manual submission ────────────────────────────────────────────────
  function submitManual() {
    const errs = validateManual(manual);
    setManualErr(errs);
    if (Object.keys(errs).length > 0) {
      // Focus the first invalid field
      manualNameRef.current?.focus();
      return;
    }
    onAdd(manualToItem(manual));
    setStep("manual-success");
  }

  // ── Reset ────────────────────────────────────────────────────────────
  function reset() {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreview(null); }
    setBlob(null);
    setAnalysis(null);
    setDraft(null);
    setError(null);
    setIsQuota(false);
    setStep("pick");
  }

  function goToManual() {
    setManual(MANUAL_DEFAULTS);
    setManualErr({});
    setStep("manual");
  }

  // ── Title ─────────────────────────────────────────────────────────────
  const title =
    step === "status-check"    ? "Add clothing" :
    step === "scan-unavailable"? "Add clothing" :
    step === "ack-required"    ? "Before you scan" :
    step === "manual"          ? "Add clothing manually" :
    step === "manual-success"  ? "Item added" :
    step === "confirm"         ? "Confirm item" :
    step === "detecting"       ? "Checking photo…" :
    step === "analyzing" || step === "compressing" ? "Analyzing…" :
    step === "error"           ? "Try another photo" :
    "Add clothing";

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
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[60] flex items-end justify-center"
    >
      {/* Hidden camera input */}
      <input ref={cameraInputRef}  type="file" accept="image/*" capture="environment"
        className="sr-only" tabIndex={-1} aria-hidden onChange={handleFileChange} />
      {/* Hidden library input */}
      <input ref={libraryInputRef} type="file" accept="image/*"
        className="sr-only" tabIndex={-1} aria-hidden onChange={handleFileChange} />

      {/* Backdrop */}
      <button aria-label="Close" onClick={onClose}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

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
          <button onClick={onClose} aria-label="Close add clothing"
            className="press grid h-9 w-9 place-items-center rounded-full bg-foreground/5 text-muted-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── STATUS CHECK ──────────────────────────────────────────── */}
        {step === "status-check" && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground"
              role="status" aria-label="Checking availability" />
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
            onSubmit={(e) => { e.preventDefault(); submitManual(); }}
            noValidate
            aria-label="Manual clothing entry form"
          >
            <div className="space-y-2.5">
              {/* Name */}
              <div>
                <label htmlFor="manual-name" className="mb-1 block text-sm font-medium text-muted-foreground">
                  Item name <span aria-hidden className="text-destructive">*</span>
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
                <label htmlFor="manual-category" className="mb-1 block text-sm font-medium text-muted-foreground">
                  Category <span aria-hidden className="text-destructive">*</span>
                </label>
                <select
                  id="manual-category"
                  value={manual.category}
                  onChange={(e) => setM("category", e.target.value as WardrobeCategory)}
                  aria-required="true"
                  className="w-full rounded-2xl bg-foreground/[0.04] px-4 py-3 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              {/* Garment type — controls matcher token score */}
              <div>
                <label htmlFor="manual-garment-type" className="mb-1 block text-sm font-medium text-muted-foreground">
                  Garment type <span aria-hidden className="text-destructive">*</span>
                </label>
                <select
                  id="manual-garment-type"
                  value={manual.garmentType}
                  onChange={(e) => setM("garmentType", e.target.value)}
                  aria-required="true"
                  className="w-full rounded-2xl bg-foreground/[0.04] px-4 py-3 text-sm outline-none ring-1 ring-transparent focus:ring-primary/40"
                >
                  {GARMENT_TYPES[manual.category].map((g) => (
                    <option key={g.type} value={g.type}>{g.label}</option>
                  ))}
                </select>
              </div>

              {/* Colour */}
              <div>
                <label htmlFor="manual-color" className="mb-1 block text-sm font-medium text-muted-foreground">
                  Primary colour <span aria-hidden className="text-destructive">*</span>
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
                  <legend className="mb-1 block text-sm font-medium text-muted-foreground">Warmth</legend>
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
                  <legend className="mb-1 block text-sm font-medium text-muted-foreground">Water resistance</legend>
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
                <label htmlFor="manual-style" className="mb-1 block text-sm font-medium text-muted-foreground">
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
            <button
              type="submit"
              className="press mt-5 w-full rounded-full bg-foreground py-3.5 text-sm font-semibold text-background"
            >
              Add to wardrobe
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

        {/* ── ACK REQUIRED ─────────────────────────────────────────── */}
        {step === "ack-required" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-muted-foreground">
              The AI scanner is for users aged 15 and older. Please confirm the following before scanning.
            </p>
            {ackError && (
              <p role="alert" className="rounded-2xl bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {ackError}
              </p>
            )}
            {/* Age band */}
            <div>
              <p className="mb-1.5 text-sm font-medium">Your age</p>
              <div className="grid grid-cols-2 gap-2">
                {(["15-17", "18-plus"] as const).map((band) => (
                  <label
                    key={band}
                    className={`flex cursor-pointer items-center justify-center rounded-2xl px-3 py-2.5 text-sm font-medium ring-1 transition-colors ${
                      ackAgeBand === band
                        ? "bg-primary/15 text-primary ring-primary/30"
                        : "bg-foreground/[0.04] text-muted-foreground ring-transparent"
                    }`}
                  >
                    <input
                      type="radio"
                      name="ack-age"
                      value={band}
                      checked={ackAgeBand === band}
                      onChange={() => { setAckAgeBand(band); setAckError(null); }}
                      className="sr-only"
                    />
                    {band === "15-17" ? "15–17 years old" : "18 or older"}
                  </label>
                ))}
              </div>
            </div>
            {/* Guardian permission — only when 15-17 selected */}
            {ackAgeBand === "15-17" && (
              <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-foreground/[0.04] px-4 py-3">
                <input
                  type="checkbox"
                  checked={ackGuardian}
                  onChange={(e) => { setAckGuardian(e.target.checked); setAckError(null); }}
                  className="mt-0.5 h-4 w-4 accent-primary"
                />
                <span className="text-sm">
                  I have a parent or guardian's permission to use the AI scanner.
                </span>
              </label>
            )}
            {/* Combined acknowledgement */}
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-foreground/[0.04] px-4 py-3">
              <input
                type="checkbox"
                checked={ackAllItems}
                onChange={(e) => { setAckAllItems(e.target.checked); setAckError(null); }}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span className="text-sm">
                I understand that my garment photo will be analyzed by Anthropic's Claude AI, and I will upload only one clothing item, without people, faces, bodies, identification documents or personal information.
              </span>
            </label>
            <button
              disabled={
                ackSubmitting ||
                !ackAgeBand ||
                !ackAllItems ||
                (ackAgeBand === "15-17" && !ackGuardian)
              }
              onClick={async () => {
                if (!ackAgeBand) { setAckError("Please select your age group."); return; }
                if (!ackAllItems) { setAckError("Please check all required boxes."); return; }
                if (ackAgeBand === "15-17" && !ackGuardian) {
                  setAckError("Please confirm parent or guardian permission."); return;
                }
                setAckSubmitting(true);
                setAckError(null);
                const res = await submitAcknowledgement(ackAgeBand, ackAgeBand === "15-17");
                setAckSubmitting(false);
                if (!res.ok) { setAckError(res.error ?? "Could not save. Please try again."); return; }
                ackCheckedRef.current = true;
                setStep("pick");
              }}
              className="press flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-semibold text-background disabled:opacity-50"
            >
              {ackSubmitting ? "Saving…" : "Continue to scan"}
            </button>
            <button
              onClick={goToManual}
              className="press flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-sm text-muted-foreground"
            >
              Add manually instead
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
                Snap a photo or choose from your library and Aeruvo will fill in the details for you.
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                onClick={() => cameraInputRef.current?.click()}
                className="press flex items-center justify-center gap-2 rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-background"
                aria-label="Take a photo with camera"
              >
                <Camera className="h-4 w-4" /> Take photo
              </button>
              <button
                onClick={() => libraryInputRef.current?.click()}
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
              <img src={previewUrl} alt="Selected clothing item" className="h-64 w-full object-cover" />
              {step === "compressing" && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                  <p className="text-sm font-medium text-white">Preparing…</p>
                </div>
              )}
            </div>
            {step === "preview" && (
              <>
                <button
                  onClick={analyze}
                  disabled={!imageBlob}
                  className="press flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-semibold text-background disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" /> Analyze with AI
                </button>
                {/* ── AI disclosure (required before any scan) ─────────── */}
                <p className="mt-1 text-center text-xs text-muted-foreground">
                  Your garment photo will be analyzed by Anthropic's Claude AI. Do not upload people, faces, bodies, identification documents or personal information.{" "}
                  <a href="/privacy" className="underline underline-offset-2">
                    Privacy Policy
                  </a>
                </p>
                <button onClick={reset}
                  className="press flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
                  <RefreshCw className="h-3.5 w-3.5" /> Choose another photo
                </button>
              </>
            )}
          </div>
        )}

        {/* ── DETECTING ─────────────────────────────────────────────── */}
        {step === "detecting" && (
          <div className="flex flex-col items-center gap-4 py-6 text-center" role="status" aria-live="polite">
            {previewUrl && (
              <div className="relative overflow-hidden rounded-[1.75rem]">
                <img src={previewUrl} alt="Checking photo" className="h-48 w-48 object-cover" />
                <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-2 animate-pulse bg-primary/30" />
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
          <div className="flex flex-col items-center gap-4 py-6 text-center" role="status" aria-live="polite">
            {previewUrl && (
              <div className="relative overflow-hidden rounded-[1.75rem]">
                <img src={previewUrl} alt="Analyzing" className="h-48 w-48 object-cover" />
                <div aria-hidden
                  className="scan-sweep pointer-events-none absolute inset-x-0 h-24 bg-gradient-to-b from-transparent via-primary/35 to-transparent" />
              </div>
            )}
            <p className="flex items-center gap-2 font-medium">
              <Sparkles className="h-4 w-4 text-primary" /> Analyzing your item…
            </p>
            <p className="text-sm text-muted-foreground">Reading colour, fabric weight, and warmth.</p>
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
              <button onClick={reset}
                className="press flex items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-semibold text-background">
                <RefreshCw className="h-4 w-4" /> Try another photo
              </button>
            )}
            {isQuotaError && (
              <a href="/premium"
                className="press flex items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-sm font-semibold text-background">
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
                <img src={previewUrl} alt={draft.name}
                  className="h-24 w-24 shrink-0 rounded-2xl object-cover" />
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
                <input value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  aria-label="Item name"
                  className="w-full bg-transparent text-right text-sm font-medium outline-none" />
              </Field>
              <Field label="Category" estimated={analysis.confidence.category < CONFIDENCE_THRESHOLD}>
                <select value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value as WardrobeCategory })}
                  aria-label="Category"
                  className="bg-transparent text-right text-sm font-medium outline-none">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Color" estimated={analysis.confidence.color < CONFIDENCE_THRESHOLD}>
                <input value={draft.color}
                  onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                  aria-label="Color"
                  className="w-full bg-transparent text-right text-sm font-medium outline-none" />
              </Field>
              <Field label="Warmth" estimated={analysis.confidence.warmth < CONFIDENCE_THRESHOLD}>
                <select value={draft.warmth}
                  onChange={(e) => setDraft({ ...draft, warmth: e.target.value as WardrobeItem["warmth"] })}
                  aria-label="Warmth"
                  className="bg-transparent text-right text-sm font-medium outline-none">
                  {(["Light", "Medium", "Warm"] as const).map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </Field>
              <Field label="Weather fit" estimated={false}>
                <input value={draft.weatherFit}
                  onChange={(e) => setDraft({ ...draft, weatherFit: e.target.value })}
                  aria-label="Weather fit"
                  className="w-full bg-transparent text-right text-sm font-medium outline-none" />
              </Field>
              <Field label="Water resistance" estimated={analysis.confidence.waterResistance < CONFIDENCE_THRESHOLD}>
                <select value={draft.waterResistance}
                  onChange={(e) => setDraft({ ...draft, waterResistance: e.target.value as WardrobeItem["waterResistance"] })}
                  aria-label="Water resistance"
                  className="bg-transparent text-right text-sm font-medium outline-none">
                  {(["Low", "Medium", "High"] as const).map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </Field>
              <Field label="Style" estimated={analysis.confidence.style < CONFIDENCE_THRESHOLD}>
                <input value={draft.style}
                  onChange={(e) => setDraft({ ...draft, style: e.target.value })}
                  aria-label="Style"
                  className="w-full bg-transparent text-right text-sm font-medium outline-none" />
              </Field>
              <Field label="Season" estimated={false}>
                <input value={draft.season}
                  onChange={(e) => setDraft({ ...draft, season: e.target.value })}
                  aria-label="Season"
                  className="w-full bg-transparent text-right text-sm font-medium outline-none" />
              </Field>
            </div>

            <button
              onClick={() => { onAdd({ ...draft, labels: [`${draft.warmth} warmth`, draft.style] }); onClose(); }}
              className="press mt-5 w-full rounded-full bg-foreground px-5 py-3.5 text-sm font-semibold text-background"
            >
              Add to wardrobe
            </button>
            <button onClick={reset}
              className="press mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-full py-2.5 text-sm text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5" /> Scan again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Field row with optional "Estimated" badge for low-confidence AI values. */
function Field({
  label, children, estimated,
}: {
  label: string; children: React.ReactNode; estimated: boolean;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-2xl bg-foreground/[0.04] px-4 py-3">
      <div className="flex shrink-0 flex-col gap-0.5">
        <span className="text-sm text-muted-foreground">{label}</span>
        {estimated && (
          <span className="text-[10px] font-medium text-primary/60 uppercase tracking-wider">Estimated</span>
        )}
      </div>
      <span className="min-w-0 flex-1 text-right">{children}</span>
    </label>
  );
}
