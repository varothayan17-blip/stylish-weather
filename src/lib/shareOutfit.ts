/**
 * shareOutfit.ts — Outfit social card generation and share/download logic.
 *
 * PRIVACY CONTRACT — the share card contains ONLY:
 *   ✓ Temperature and weather condition (visible in hero)
 *   ✓ Outfit item names (visible in recommendation card)
 *   ✓ Recommendation headline (visible in recommendation card)
 *   ✓ Aeruvo branding
 *
 * Excluded: name, email, uid, exact location/coordinates, city,
 *   commute mode, subscription state, style profile answers,
 *   wardrobe photos, internal IDs, analytics values.
 *
 * OUTFIT ARRAY REQUIREMENT:
 *   Callers must pass the exact final array rendered on screen.
 *   In index.tsx this is `mergedOutfit` (rec.outfit + personalization.extraItems).
 *   In recommendation.tsx this is [...rec.outfit, ...personalization.extraItems].
 *   This utility deduplicates (preserving order) but never re-derives the outfit.
 *
 * SSR SAFETY:
 *   All browser APIs (Canvas, navigator, document) are accessed only inside
 *   async functions. No browser global is referenced at module evaluation time.
 */

// ── Card dimensions (Instagram Story format) ─────────────────────────────────
const CARD_W = 1080;
const CARD_H = 1920;

// ── Aeruvo colour palette ────────────────────────────────────────────────────
const NAVY    = "#0f172a";
const BLUE    = "#3b82f6";
const SLATE   = "#64748b";
const BG_TOP  = "#e0f2fe";
const BG_BOT  = "#bfdbfe";
const CARD_BG = "rgba(255,255,255,0.72)";
const ITEM_BG = "rgba(255,255,255,0.90)";

// ── Font helpers ─────────────────────────────────────────────────────────────
const STACK = `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
const font  = (w: number, size: number) => `${w} ${size}px ${STACK}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Deduplicate outfit items, preserving order, case-insensitive.
 * Exported so callers can test deduplication independently.
 */
export function deduplicateOutfit(items: string[]): string[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ── Public types ──────────────────────────────────────────────────────────────

/**
 * Derive display labels from the same resolvedSlots data that OutfitSlotList
 * uses to render the home screen, then append deduplicated personalization
 * extra items.
 *
 * Both OutfitSlotList and this function read from resolvedSlots (computed once
 * by useResolvedSlots). They independently apply the same "Your " prefix for
 * matched slots. OutfitSlotList does not call this function — it constructs
 * the label directly in JSX. If the prefix convention in OutfitSlotList ever
 * changes, this function must be updated to match.
 *
 * @param resolvedSlots  From useResolvedSlots().resolvedSlots.
 *   - matched === false → use genericText (e.g. "Jeans")
 *   - matched === true  → use "Your " + itemName (e.g. "Your Blue jeans")
 * @param extraItems  personalization.extraItems — appended after base slots.
 */
export function resolvedSlotsToDisplayLabels(
  resolvedSlots: Array<
    | { matched: false; genericText: string }
    | { matched: true; genericText: string; itemName: string; itemId: string; itemTint: string }
  >,
  extraItems: string[],
): string[] {
  const baseLabels = resolvedSlots.map(slot =>
    slot.matched ? `Your ${slot.itemName}` : slot.genericText,
  );
  return deduplicateOutfit([...baseLabels, ...extraItems]);
}

/**
 * The minimum data needed to generate and share an outfit card.
 * Contains only weather and clothing data already visible in the UI.
 * No user-identifying or sensitive fields.
 */
export interface ShareCardInput {
  /**
   * Display labels matching what is visible on screen, in rendered order.
   * Should come from resolvedSlotsToDisplayLabels() on the home screen so
   * wardrobe-matched slots appear as "Your {itemName}" rather than generic
   * text. generateOutfitCard() deduplicates defensively.
   */
  outfitItems: string[];
  /** Recommendation headline as displayed. */
  headline:    string;
  /** Temperature in °C as displayed in the hero. */
  tempC:       number;
  /** Concise weather condition as displayed in the hero. */
  condition:   string;
}

// ── Card generation ───────────────────────────────────────────────────────────

/**
 * Render a 1080×1920 branded outfit card and return it as a PNG File.
 * Must only be called in a browser context. Throws if Canvas is unavailable.
 */
export async function generateOutfitCard(input: ShareCardInput): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width  = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D not available");

  const items = deduplicateOutfit(input.outfitItems);
  const PAD   = 80;
  const INNER = CARD_W - PAD * 2;

  // Background gradient
  const grad = ctx.createLinearGradient(0, 0, 0, CARD_H);
  grad.addColorStop(0, BG_TOP);
  grad.addColorStop(1, BG_BOT);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  let y = PAD + 20;

  // Brand name
  ctx.font      = font(700, 72);
  ctx.fillStyle = BLUE;
  ctx.textAlign = "center";
  ctx.fillText("Aeruvo", CARD_W / 2, y + 72);
  y += 72 + 24;

  // Section heading
  ctx.font      = font(600, 46);
  ctx.fillStyle = SLATE;
  ctx.fillText("Today's outfit", CARD_W / 2, y + 46);
  y += 46 + 56;

  // Weather card
  const WH = 180;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.10)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 8;
  roundRect(ctx, PAD, y, INNER, WH, 48);
  ctx.fillStyle = CARD_BG; ctx.fill();
  ctx.restore();

  ctx.textAlign = "left";
  ctx.font      = font(700, 80);
  ctx.fillStyle = NAVY;
  ctx.fillText(`${Math.round(input.tempC)}°`, PAD + 56, y + WH / 2 + 28);

  const tempW = ctx.measureText(`${Math.round(input.tempC)}°`).width;
  ctx.font      = font(600, 44);
  ctx.fillStyle = SLATE;
  const condLines = wrapText(ctx, input.condition, INNER - tempW - 120);
  condLines.forEach((line, i) =>
    ctx.fillText(line, PAD + 56 + tempW + 56, y + WH / 2 - ((condLines.length - 1) * 50) / 2 + i * 50));
  y += WH + 40;

  // Headline
  ctx.font = font(600, 48); ctx.fillStyle = NAVY; ctx.textAlign = "center";
  const headLines = wrapText(ctx, input.headline, INNER - 40);
  headLines.forEach((line, i) => ctx.fillText(line, CARD_W / 2, y + 48 + i * 58));
  y += headLines.length * 58 + 56;

  // Outfit items
  const IH = 120, IGAP = 20, IR = 40, DR = 16;
  const DOT_COLORS = [BLUE, "#10b981", "#f59e0b", "#8b5cf6", "#ef4444", "#06b6d4"];
  for (let i = 0; i < items.length; i++) {
    const iy = y + i * (IH + IGAP);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.07)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 4;
    roundRect(ctx, PAD, iy, INNER, IH, IR);
    ctx.fillStyle = ITEM_BG; ctx.fill();
    ctx.restore();
    const dx = PAD + 56 + DR;
    ctx.beginPath(); ctx.arc(dx, iy + IH / 2, DR, 0, Math.PI * 2);
    ctx.fillStyle = DOT_COLORS[i % DOT_COLORS.length]; ctx.fill();
    ctx.font = font(600, 46); ctx.fillStyle = NAVY; ctx.textAlign = "left";
    ctx.fillText(titleCase(items[i]), dx + DR + 32, iy + IH / 2 + 16);
  }
  y += items.length * (IH + IGAP) + 64;

  // Footer
  const fy = Math.max(y, CARD_H - 220);
  ctx.textAlign = "center"; ctx.globalAlpha = 0.80;
  ctx.font = font(600, 44); ctx.fillStyle = NAVY;
  ctx.fillText("Dress smarter with Aeruvo", CARD_W / 2, fy);
  ctx.font = font(400, 40); ctx.fillStyle = BLUE; ctx.globalAlpha = 0.90;
  ctx.fillText("aeruvo.app", CARD_W / 2, fy + 56);
  ctx.globalAlpha = 1;

  return new Promise<File>((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) { reject(new Error("Canvas toBlob returned null")); return; }
      resolve(new File([blob], "aeruvo-outfit.png", { type: "image/png" }));
    }, "image/png");
  });
}

// ── Capability detection ──────────────────────────────────────────────────────

/**
 * Returns true when the browser Web Share API supports file sharing.
 * Safe in SSR — returns false when navigator is undefined.
 */
export function canShareFiles(): boolean {
  if (typeof navigator === "undefined") return false;
  if (typeof navigator.share !== "function") return false;
  if (typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({
      files: [new File([""], "t.png", { type: "image/png" })],
    });
  } catch {
    return false;
  }
}

// ── Share result ──────────────────────────────────────────────────────────────

export interface ShareResult {
  action: "shared" | "downloaded" | "text-shared" | "text-copied" | "cancelled" | "error";
  /** User-facing toast message. Absent for "shared" and "cancelled". */
  message?: string;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Generate the outfit card and share or download it.
 *
 * Cascade:
 *   1. Generate PNG card
 *   2. Web Share API + files     → action: "shared"
 *   3. PNG download fallback     → action: "downloaded"
 *   4. navigator.share text      → action: "text-shared"
 *   5. clipboard.writeText       → action: "text-copied"
 *   6. Failure                   → action: "error"
 *   AbortError at any step       → action: "cancelled" (no toast)
 *
 * @param input        Card data. outfitItems must be the final merged array on screen.
 * @param textFallback Plain-text outfit summary for the text-only fallback path.
 */
export async function shareOrDownload(
  input: ShareCardInput,
  textFallback: string,
): Promise<ShareResult> {
  // Step 1 — generate image
  let file: File | null = null;
  try { file = await generateOutfitCard(input); } catch { /* fall through */ }

  // Step 2 — Web Share API with file
  if (file && canShareFiles()) {
    try {
      await navigator.share({
        files: [file],
        title: "Today's outfit — Aeruvo",
        text:  "My weather-ready outfit from Aeruvo",
      });
      return { action: "shared" };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return { action: "cancelled" };
      // fall through to download
    }
  }

  // Step 3 — PNG download
  if (file) {
    try {
      const url = URL.createObjectURL(file);
      const a   = document.createElement("a");
      a.href = url; a.download = "aeruvo-outfit.png";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return { action: "downloaded", message: "Outfit card downloaded — share it anywhere." };
    } catch { /* fall through */ }
  }

  // Step 4 — text share
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: "Today's outfit — Aeruvo", text: textFallback });
      return { action: "text-shared" };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return { action: "cancelled" };
    }
  }

  // Step 5 — clipboard
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(textFallback);
      return { action: "text-copied", message: "Outfit copied to clipboard." };
    } catch { /* fall through */ }
  }

  return { action: "error", message: "Couldn't share this outfit. Please try again." };
}
