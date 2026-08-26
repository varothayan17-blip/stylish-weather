/**
 * AddClothingSheet.tsx — Real camera + Gemini AI clothing analysis.
 *
 * Pipeline:
 *   pick → (camera/photo) → preview → compress → analyze → confirm → add
 *
 * Security:
 *   - Firebase ID token sent in Authorization header; server verifies it.
 *   - No uid in request body.
 *   - Image bytes not persisted after session.
 *   - Gemini API key never in client bundle.
 *
 * Camera/Photo:
 *   Take Photo  → <input capture="environment" accept="image/*">
 *   Choose Photo → <input accept="image/*"> (no capture)
 *   Both are hidden <input> elements triggered imperatively.
 *
 * Compression:
 *   Canvas-based resize + re-encode to JPEG @ 82% quality.
 *   Max dimension 1400px. HEIC decoded by browser before canvas (iOS 17+).
 *   If canvas decode fails, the original file is sent as-is with a warning.
 */

import { useEffect, useRef, useState } from "react";
import { Camera, ImageIcon, X, Sparkles, Check, AlertCircle, RefreshCw } from "lucide-react";
import { CATEGORIES, type WardrobeItem, type WardrobeCategory } from "./wardrobeData";
import type { ClothingAnalysis, ScanStep } from "@/lib/wardrobe-types";
import { getFirebaseAuth } from "@/lib/firebase";

// ── Constants ──────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.60; // below this → show "Estimated" badge

// ── Image compression ──────────────────────────────────────────────────────

const MAX_DIMENSION = 1400;
const JPEG_QUALITY  = 0.82;

async function compressImage(file: File): Promise<{ blob: Blob; objectUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
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
            const objectUrl = URL.createObjectURL(blob);
            resolve({ blob, objectUrl });
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

// ── Wardrobe scanning status ─────────────────────────────────────────────────

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
    return false; // network failure → treat as unavailable
  }
}

// ── AI scan API call ───────────────────────────────────────────────────────

async function scanWithAI(blob: Blob): Promise<ClothingAnalysis> {
  const auth  = await getFirebaseAuth();
  const user  = auth?.currentUser;
  if (!user) throw new Error("Please sign in to scan clothing.");

  const idToken = await user.getIdToken();

  const res = await fetch("/api/wardrobe/scan", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${idToken}`,
      "Content-Type": blob.type || "image/jpeg",
      "Content-Length": String(blob.size),
    },
    body: blob,
  });

  const data = await res.json() as { ok: boolean; analysis?: ClothingAnalysis; error?: string; code?: string };

  if (!data.ok) {
    const msg = data.error ?? "Analysis failed. Please try another photo.";
    if (data.code === "quota") throw Object.assign(new Error(msg), { code: "quota" });
    if (data.code === "wardrobe_scanning_temporarily_unavailable")
      throw Object.assign(new Error(msg), { code: "wardrobe_scanning_temporarily_unavailable" });
    throw new Error(msg);
  }

  if (!data.analysis) throw new Error("No analysis returned. Please try another photo.");
  return data.analysis;
}

// ── Analysis → WardrobeItem mapping ───────────────────────────────────────

function analysisToItem(a: ClothingAnalysis): Omit<WardrobeItem, "id"> {
  // Map AI category → existing WardrobeCategory
  const categoryMap: Record<string, WardrobeCategory> = {
    tops: "Tops", bottoms: "Bottoms", outerwear: "Outerwear",
    shoes: "Shoes", accessories: "Accessories", dress: "Tops", other: "Tops",
  };
  const category = categoryMap[a.category] ?? "Tops";

  // Map warmth label → existing Warmth
  const warmthMap: Record<string, "Light" | "Medium" | "Warm"> = {
    "very-light": "Light", "light": "Light",
    "medium": "Medium",
    "warm": "Warm", "very-warm": "Warm",
  };
  const warmth = warmthMap[a.warmth.label] ?? "Medium";

  // Map waterResistance → existing scale
  const waterMap: Record<string, "Low" | "Medium" | "High"> = {
    none: "Low", low: "Low", unknown: "Low",
    medium: "Medium", high: "High",
  };
  const waterResistance = waterMap[a.waterResistance] ?? "Low";

  // Build a tint from primary colour (rough approximation for the tile)
  const tint = colourToTint(a.primaryColor);

  const weatherFit = a.weatherFit.join(" / ") || "All weather";
  const style      = a.styles[0] ?? "Casual";
  const season     = a.seasons.join(" / ") || "All season";
  const typeParts  = [category, a.subcategory].filter(Boolean);

  return {
    name:            a.name,
    category,
    type:            typeParts.join(" / "),
    color:           a.primaryColor,
    warmth,
    weatherFit,
    waterResistance,
    style,
    season,
    labels:          [`${warmth} warmth`, style],
    tint,
    // Attach full AI analysis for future rich wardrobe features
    aiAnalysis:      a,
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

// ── Component ──────────────────────────────────────────────────────────────

export function AddClothingSheet({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (item: Omit<WardrobeItem, "id">) => void;
}) {
  const [step, setStep]             = useState<ScanStep>("pick");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [imageBlob, setImageBlob]   = useState<Blob | null>(null);
  const [analysis, setAnalysis]     = useState<ClothingAnalysis | null>(null);
  const [draft, setDraft]           = useState<Omit<WardrobeItem, "id"> | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [isQuotaError, setIsQuotaError]               = useState(false);

  // Scanning availability — checked once per sheet session on open.
  // null = not checked yet, true/false = result.
  // Cached so repeated open/close cycles do not re-fetch in the same session.
  const scanEnabledRef = useRef<boolean | null>(null);

  // Hidden file inputs — one for camera, one for library
  const cameraInputRef  = useRef<HTMLInputElement>(null);
  const libraryInputRef = useRef<HTMLInputElement>(null);

  // Cleanup object URLs on unmount or reset
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Reset all state when sheet closes
  useEffect(() => {
    if (!open) {
      setStep("pick");
      setAnalysis(null);
      setDraft(null);
      setError(null);
      setIsQuotaError(false);
      setImageBlob(null);
      scanEnabledRef.current = null; // reset per-session cache
      if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Check scanning availability when the sheet opens.
  // Shows a status-check step briefly, then either pick (enabled) or
  // scan-unavailable (disabled/error). Camera inputs are never opened
  // during the check. Result is cached for the session.
  useEffect(() => {
    if (!open) return;
    if (scanEnabledRef.current !== null) {
      // Already checked this session — jump straight to the right step
      if (step === "status-check")
        setStep(scanEnabledRef.current ? "pick" : "scan-unavailable");
      return;
    }
    setStep("status-check");
    let cancelled = false;
    fetchScanningStatus().then((enabled) => {
      if (cancelled) return;
      scanEnabledRef.current = enabled;
      setStep(enabled ? "pick" : "scan-unavailable");
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  // ── File selection handler (shared by camera + library inputs) ────────
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset input so same file can be re-selected
    e.target.value = "";
    if (!file) return; // user cancelled — do nothing

    // Show preview immediately using the raw file
    const rawUrl = URL.createObjectURL(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(rawUrl);
    setImageBlob(null);
    setAnalysis(null);
    setDraft(null);
    setError(null);
    setIsQuotaError(false);
    setStep("preview");

    // Compress in background — update blob when ready
    try {
      setStep("compressing");
      const { blob, objectUrl } = await compressImage(file);
      URL.revokeObjectURL(rawUrl);
      setPreviewUrl(objectUrl);
      setImageBlob(blob);
      setStep("preview");
    } catch {
      // Compression failed — use original file (may be large but is better than nothing)
      setImageBlob(file);
      setStep("preview");
    }
  }

  // ── Start AI analysis ─────────────────────────────────────────────────
  async function analyze() {
    if (!imageBlob) return;
    setStep("analyzing");
    setError(null);
    setIsQuotaError(false);
    try {
      const result = await scanWithAI(imageBlob);
      setAnalysis(result);
      setDraft(analysisToItem(result));
      setStep("confirm");
    } catch (err) {
      const errCode = err instanceof Error && "code" in err ? (err as { code?: string }).code : undefined;
      const msg = err instanceof Error ? err.message : "Analysis failed.";
      const isQuota = errCode === "quota";
      // wardrobe_scanning_temporarily_unavailable: show the friendly message;
      // no mention of 18+, adult content, or feature specifics.
      // isQuota stays false so the UI shows the error text rather than an upgrade prompt.
      setError(msg);
      setIsQuotaError(isQuota);
      setStep("error");
    }
  }

  // ── Reset to pick ─────────────────────────────────────────────────────
  function reset() {
    if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null); }
    setImageBlob(null);
    setAnalysis(null);
    setDraft(null);
    setError(null);
    setIsQuotaError(false);
    setStep("pick");
  }

  // ── Title by step ─────────────────────────────────────────────────────
  const title =
    step === "status-check"     ? "Add clothing" :
    step === "scan-unavailable" ? "Add clothing" :
    step === "confirm"    ? "Confirm item" :
    step === "analyzing" || step === "compressing" ? "Analyzing…" :
    step === "error"      ? "Try another photo" :
    "Add clothing";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Add clothing"
      className="fixed inset-0 z-[60] flex items-end justify-center"
    >
      {/* Hidden camera input — rear camera preferred */}
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
      {/* Hidden library input — no capture, opens photo picker */}
      <input
        ref={libraryInputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={handleFileChange}
      />

      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div className="glass-card relative max-h-[88vh] w-full max-w-md overflow-y-auto rounded-b-none rounded-t-[2rem] p-5 pb-8 animate-fade-up sm:mb-6 sm:rounded-[2rem]">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close add clothing"
            className="press grid h-9 w-9 place-items-center rounded-full bg-foreground/5 text-muted-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── PICK ─────────────────────────────────────────────────── */}
        {/* ── STATUS CHECK ───────────────────────────────────────── */}
        {step === "status-check" && (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-muted-foreground">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-foreground" />
            <p className="text-sm">Checking availability…</p>
          </div>
        )}

        {/* ── SCAN UNAVAILABLE ────────────────────────────────────── */}
        {step === "scan-unavailable" && (
          <div className="flex flex-col gap-4">
            <div className="glass-card rounded-[1.75rem] px-6 py-8 text-center">
              <AlertCircle className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="font-semibold">Scanning temporarily unavailable</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Wardrobe scanning is temporarily unavailable while we improve it.
                You can still add clothing manually.
              </p>
            </div>
            <button
              onClick={() => {
                // Skip to the confirm form with an empty draft for manual entry
                setDraft({
                  name: "", category: "Tops" as const, type: "",
                  color: "", warmth: "Medium" as const, style: "Casual" as const,
                  weatherFit: "", waterResistance: "Low" as const,
                  season: "", tint: "", labels: [],
                });
                setAnalysis(null);
                setStep("confirm");
              }}
              className="press flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-semibold text-background"
            >
              Add manually
            </button>
          </div>
        )}

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
              >
                <Camera className="h-4 w-4" /> Take photo
              </button>
              <button
                onClick={() => libraryInputRef.current?.click()}
                className="press glass-card flex items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold"
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
                <button
                  onClick={analyze}
                  disabled={!imageBlob}
                  className="press flex w-full items-center justify-center gap-2 rounded-full bg-foreground py-3.5 text-sm font-semibold text-background disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" /> Analyze with AI
                </button>
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

        {/* ── ANALYZING ─────────────────────────────────────────────── */}
        {step === "analyzing" && (
          <div className="flex flex-col items-center gap-4 py-6 text-center" role="status" aria-live="polite">
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

        {/* ── CONFIRM ───────────────────────────────────────────────── */}
        {step === "confirm" && draft && analysis && (
          <div>
            {/* Header — actual photo + AI summary */}
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
                {analysis.evidence && (
                  <p className="mt-1.5 text-xs italic text-muted-foreground">{analysis.evidence}</p>
                )}
              </div>
            </div>

            {/* Editable fields — pre-filled by AI */}
            <div className="mt-5 space-y-2.5">
              <Field label="Item" estimated={false}>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className="w-full bg-transparent text-right text-sm font-medium outline-none"
                />
              </Field>
              <Field label="Category" estimated={analysis.confidence.category < CONFIDENCE_THRESHOLD}>
                <select
                  value={draft.category}
                  onChange={(e) => setDraft({ ...draft, category: e.target.value as WardrobeCategory })}
                  className="bg-transparent text-right text-sm font-medium outline-none"
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Color" estimated={analysis.confidence.color < CONFIDENCE_THRESHOLD}>
                <input
                  value={draft.color}
                  onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                  className="w-full bg-transparent text-right text-sm font-medium outline-none"
                />
              </Field>
              <Field label="Warmth" estimated={analysis.confidence.warmth < CONFIDENCE_THRESHOLD}>
                <select
                  value={draft.warmth}
                  onChange={(e) => setDraft({ ...draft, warmth: e.target.value as WardrobeItem["warmth"] })}
                  className="bg-transparent text-right text-sm font-medium outline-none"
                >
                  {(["Light", "Medium", "Warm"] as const).map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </Field>
              <Field label="Weather fit" estimated={false}>
                <input
                  value={draft.weatherFit}
                  onChange={(e) => setDraft({ ...draft, weatherFit: e.target.value })}
                  className="w-full bg-transparent text-right text-sm font-medium outline-none"
                />
              </Field>
              <Field label="Water resistance" estimated={analysis.confidence.waterResistance < CONFIDENCE_THRESHOLD}>
                <select
                  value={draft.waterResistance}
                  onChange={(e) => setDraft({ ...draft, waterResistance: e.target.value as WardrobeItem["waterResistance"] })}
                  className="bg-transparent text-right text-sm font-medium outline-none"
                >
                  {(["Low", "Medium", "High"] as const).map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </Field>
              <Field label="Style" estimated={analysis.confidence.style < CONFIDENCE_THRESHOLD}>
                <input
                  value={draft.style}
                  onChange={(e) => setDraft({ ...draft, style: e.target.value })}
                  className="w-full bg-transparent text-right text-sm font-medium outline-none"
                />
              </Field>
              <Field label="Season" estimated={false}>
                <input
                  value={draft.season}
                  onChange={(e) => setDraft({ ...draft, season: e.target.value })}
                  className="w-full bg-transparent text-right text-sm font-medium outline-none"
                />
              </Field>
            </div>

            {/* Actions */}
            <button
              onClick={() => { onAdd({ ...draft, labels: [`${draft.warmth} warmth`, draft.style] }); onClose(); }}
              className="press mt-5 w-full rounded-full bg-foreground px-5 py-3.5 text-sm font-semibold text-background"
            >
              Add to wardrobe
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
  );
}

/** Field row with optional "Estimated" badge for low-confidence AI values */
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
          <span className="text-[10px] font-medium text-primary/60 uppercase tracking-wider">Estimated</span>
        )}
      </div>
      <span className="min-w-0 flex-1 text-right">{children}</span>
    </label>
  );
}
