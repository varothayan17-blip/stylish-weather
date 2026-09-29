/**
 * Wardrobe reference-photo regression checks.
 * Run: node tests/wardrobe-photo.test.cjs
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const photoStore = read("src/lib/wardrobePhotoStore.ts");
const data = read("src/components/wardrobe/wardrobeData.ts");
const store = read("src/components/wardrobe/wardrobeStore.ts");
const tile = read("src/components/wardrobe/ItemTile.tsx");
const add = read("src/components/wardrobe/AddClothingSheet.tsx");
const wardrobeRoute = read("src/routes/wardrobe.tsx");
const home = read("src/components/OutfitSlotList.tsx");
const activePlan = read("src/components/ActivePlanCard.tsx");
const plan = read("src/routes/plan.tsx");
const privacy = read("src/routes/privacy.tsx");
const consent = read("src/components/wardrobe/ScanConsentSheet.tsx");
const settings = read("src/routes/settings.tsx");

let passed = 0;
let failed = 0;
function ok(name, condition) {
  if (condition) {
    passed += 1;
    console.log(`✓ ${name}`);
  } else {
    failed += 1;
    console.error(`✗ ${name}`);
  }
}

ok(
  "P01. optional photo flag preserves old wardrobe items",
  data.includes("hasLocalPhoto?: boolean"),
);
ok("P02. photos use IndexedDB", photoStore.includes("indexedDB.open(DB_NAME, DB_VERSION)"));
ok(
  "P03. photo DB is separate from metadata",
  photoStore.includes('const DB_NAME = "aeruvo-wardrobe-media"'),
);
ok(
  "P04. raw photo is not stored in localStorage",
  !/\blocalStorage\s*\./.test(photoStore) && !/window\.localStorage/.test(photoStore),
);
ok("P05. local photo store makes no network request", !/\bfetch\s*\(/.test(photoStore));
ok(
  "P06. local photo store has no Firebase dependency",
  !/from\s+["'][^"']*firebase/i.test(photoStore),
);
ok("P07. thumbnail is re-encoded through canvas", photoStore.includes("canvas.toBlob("));
ok("P08. cleaned thumbnail uses JPEG", photoStore.includes('"image/jpeg"'));
ok("P09. thumbnail dimension is bounded", photoStore.includes("maxDimension = 480"));
ok("P10. source bitmap is closed", photoStore.includes("bitmap.close()"));
ok("P11. item photo is keyed by exact item ID", photoStore.includes("store.put(blob, itemId)"));
ok("P12. item removal deletes its photo", store.includes("deleteWardrobePhoto(id)"));
ok("P13. wardrobe clear deletes all photos", store.includes("clearWardrobePhotos()"));
ok(
  "P14. add returns generated item ID",
  store.includes('add(item: Omit<WardrobeItem, "id">): string | null'),
);
ok("P15. scanned-photo saving is explicit opt-in", add.includes("checked={saveReferencePhoto}"));
ok(
  "P16. opt-in is off by default",
  add.includes("useState(false)") && add.includes("saveReferencePhoto"),
);
ok(
  "P17. original photo is converted before persistence",
  add.includes("createWardrobeThumbnail(imageBlob)"),
);
ok("P18. add callback receives optional reference blob", add.includes("referencePhoto?: Blob"));
ok(
  "P19. route saves photo under returned item ID",
  wardrobeRoute.includes("saveWardrobePhoto(id, referencePhoto)"),
);
ok(
  "P20. metadata flag is set only after photo save",
  wardrobeRoute.indexOf("saveWardrobePhoto(id, referencePhoto)") <
    wardrobeRoute.indexOf("hasLocalPhoto: true"),
);
ok("P21. failed photo save rolls back item", wardrobeRoute.includes("wardrobe.remove(id)"));
ok(
  "P22. tile loads photo using exact item ID",
  tile.includes("useWardrobePhotoUrl(itemId, hasLocalPhoto)"),
);
ok(
  "P23. tile renders actual image with object-cover",
  tile.includes("<img") && tile.includes("object-cover"),
);
ok("P24. tile preserves icon fallback", tile.includes("<Icon") && tile.includes("photoUrl ?"));
ok("P25. home recommendation passes matched item ID", home.includes("itemId={item.id}"));
ok(
  "P26. home recommendation passes matched photo flag",
  home.includes("hasLocalPhoto={item.hasLocalPhoto === true}"),
);
ok(
  "P27. outing planner resolves by wardrobeId",
  plan.includes("wardrobeById.get(item.wardrobeId)"),
);
ok(
  "P28. outing planner renders exact item tile",
  plan.includes("wardrobeItem={wardrobeItemFor(item)}"),
);
ok(
  "P29. locked home plan renders wardrobe photos",
  activePlan.includes("planned.wardrobeId") &&
    activePlan.includes("hasLocalPhoto={item.hasLocalPhoto === true}"),
);
ok(
  "P30. privacy identifies IndexedDB local storage",
  privacy.includes("<code>IndexedDB</code> for optional wardrobe reference"),
);
ok(
  "P31. privacy says thumbnail is not uploaded",
  /thumbnail is not uploaded to Aeruvo,\s+Firebase Storage/.test(privacy),
);
ok(
  "P32. scan consent distinguishes optional thumbnail",
  consent.includes("optionally save a small cleaned reference"),
);
ok(
  "P33. account deletion clears local photos",
  settings.includes("await clearWardrobePhotos().catch"),
);
ok(
  "P34. reset clears local photos",
  (settings.match(/clearWardrobePhotos\(\)/g) ?? []).length >= 2,
);

console.log(`\n${passed}/${passed + failed} passed`);
if (failed) process.exit(1);
