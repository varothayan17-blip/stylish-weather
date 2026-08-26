/**
 * Firestore Security Rules emulator tests for Aeruvo.
 * CommonJS format (.cjs) — compatible with "type":"module" in package.json.
 *
 * Run from repo root after starting the emulator:
 *   npx firebase-tools emulators:start --only firestore --project wethra-1aa65 &
 *   sleep 12
 *   node tests/firestore-rules.test.cjs
 *
 * Requires: @firebase/rules-unit-testing (installed as devDependency)
 *
 * KEY RULE INVARIANT: data.id must equal the Firestore document ID (favoriteId).
 * This mirrors cloudSync.syncFavorite which writes:
 *   setDoc(doc(collection(db, "users", uid, "favorites"), safe.id), safe)
 * i.e. document ID is always derived from favorite.id.
 * Any test fixture must satisfy favA(X).set({id:X, ...}).
 */

const {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} = require("@firebase/rules-unit-testing");
const fs   = require("fs");
const path = require("path");

const RULES      = fs.readFileSync(path.resolve(__dirname, "../firestore.rules"), "utf8");
const PROJECT_ID = "wethra-1aa65";

async function run() {
  const env = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    firestore: { rules: RULES, host: "127.0.0.1", port: 8080 },
  });

  let pass = 0, fail = 0;
  const ok   = (name, p) => assertSucceeds(p)
    .then(()=>{ console.log("✓", name); pass++; })
    .catch(e =>{ console.error("✗", name, e?.message?.slice(0, 100)); fail++; });
  const deny = (name, p) => assertFails(p)
    .then(()=>{ console.log("✓", name); pass++; })
    .catch(e =>{ console.error("✗", name, "Expected denial, got:", e?.message?.slice(0, 100)); fail++; });

  const alice = env.authenticatedContext("uid-alice");
  const bob   = env.authenticatedContext("uid-bob");
  const anon  = env.unauthenticatedContext();
  const dbA   = alice.firestore();
  const dbB   = bob.firestore();
  const dbX   = anon.firestore();

  const now = Date.now();

  // Helper: returns a ref to users/uid-alice/favorites/{id}
  const favA    = (id) => dbA.collection("users").doc("uid-alice").collection("favorites").doc(id);
  const favAasB = (id) => dbB.collection("users").doc("uid-alice").collection("favorites").doc(id);
  const favAasX = (id) => dbX.collection("users").doc("uid-alice").collection("favorites").doc(id);

  // ── Exact cloudSync.syncFavorite payloads ─────────────────────────────────
  //
  // cloudSync always writes: setDoc(doc(col, safe.id), safe)
  // so the document ID MUST equal safe.id (= favorite.id).
  // All test fixtures must satisfy: favA(X).set({id: X, ...})
  //
  // cloudSync payload shape (v2 — new favorites):
  //   { id, title, slots, items, tempC, condition, savedAt }
  //   where items = slots.map(s => s.matched ? s.itemName : s.genericText)
  //
  // Legacy cloud records (written before the slots update) have:
  //   { id, title, items, tempC, condition, savedAt }  (no slots key)

  // v2 payload — exact shape produced by cloudSync.syncFavorite for a Premium outfit
  const cloudsyncV2 = {
    id:        "outfit-v2",
    title:     "Autumn layers",
    slots:     [
      { matched: true,  genericText: "LS shirt",  itemName: "Blue gingham LS", itemId: "ls-1", itemTint: "from-blue-400" },
      { matched: false, genericText: "Jeans" },
    ],
    items:     ["Blue gingham LS", "Jeans"],   // derived from slots by cloudSync
    tempC:     14,
    condition: "Overcast",
    savedAt:   now,
  };

  // cloudSync payload for a legacy Favorite (pre-slots): slots: [], items: [...]
  // This is what cloudSync writes when favorite.slots is undefined → ?? []
  const cloudsyncLegacyResync = {
    id:        "outfit-legacy-resync",
    title:     "Classic look",
    slots:     [],                             // favorite.slots ?? [] = []
    items:     ["LS shirt", "Jeans"],          // original legacy items
    tempC:     16,
    condition: "Clear",
    savedAt:   now,
  };

  // True legacy cloud record (items only, no slots key) — written before slots update
  // Still must be accepted for backward compatibility (read from Firestore, re-written)
  const legacyCloudRecord = {
    id:        "outfit-legacy-cloud",
    title:     "Old cloud save",
    items:     ["LS shirt", "Jeans"],
    tempC:     16,
    condition: "Clear",
    savedAt:   now,
    // No "slots" key — this is the shape of pre-update cloud records
  };

  // Slots-only record (no items key) — also valid per rules
  const slotsOnly = {
    id:        "outfit-slots-only",
    title:     "Slots only",
    slots:     [{ matched: false, genericText: "T-shirt" }],
    tempC:     20,
    condition: "Sunny",
    savedAt:   now,
  };

  // ── 1. Ownership tests ────────────────────────────────────────────────────
  console.log("\n── 1. Ownership ──────────────────────────────────────────────");
  // Uses cloudsyncV2 fixture — doc ID matches data.id ("outfit-v2")
  await ok  ("Alice writes own fav (v2 payload)",          favA("outfit-v2").set(cloudsyncV2));
  await ok  ("Alice reads own fav",                        favA("outfit-v2").get());
  await deny("Bob cannot read Alice's fav",                favAasB("outfit-v2").get());
  await deny("Bob cannot write Alice's fav",               favAasB("outfit-v2").set(cloudsyncV2));
  await deny("Anon cannot read Alice's fav",               favAasX("outfit-v2").get());
  await deny("Alice cannot delete own fav (delete=false)", favA("outfit-v2").delete());

  // ── 2. Valid shapes (all with matching doc ID and data.id) ────────────────
  console.log("\n── 2. Valid shapes ───────────────────────────────────────────");

  await ok("cloudSync v2 payload (slots + derived items) accepted",
    favA("outfit-v2").set(cloudsyncV2));                          // already written above; update is ok

  await ok("cloudSync legacy re-sync (slots:[], items:[...]) accepted",
    favA("outfit-legacy-resync").set(cloudsyncLegacyResync));

  await ok("True legacy cloud record (items only, no slots key) accepted",
    favA("outfit-legacy-cloud").set(legacyCloudRecord));

  await ok("Slots-only record (no items key) accepted",
    favA("outfit-slots-only").set(slotsOnly));

  await ok("20 slots (max) accepted", favA("max20").set({
    id:        "max20",
    title:     "Max slots",
    slots:     Array.from({ length: 20 }, (_, i) => ({ matched: false, genericText: `slot-${i}` })),
    items:     Array.from({ length: 20 }, (_, i) => `slot-${i}`),
    tempC:     15,
    condition: "Clear",
    savedAt:   now,
  }));

  await ok("20 items (max, legacy) accepted", favA("max20-items").set({
    id:        "max20-items",
    title:     "Max items",
    items:     Array.from({ length: 20 }, (_, i) => `item-${i}`),
    tempC:     15,
    condition: "Clear",
    savedAt:   now,
  }));

  // ── 3. Rejections ─────────────────────────────────────────────────────────
  console.log("\n── 3. Rejections ─────────────────────────────────────────────");

  await deny("Doc ID mismatch (data.id != favoriteId) rejected",
    favA("wrong-doc-id").set({ ...cloudsyncV2, id: "different-id" }));

  await deny("Missing both slots and items rejected",
    favA("bad-no-content").set({
      id: "bad-no-content", title: "T", tempC: 16, condition: "Clear", savedAt: now,
    }));

  await deny("Unexpected top-level field rejected",
    favA("bad-extra").set({
      ...cloudsyncV2, id: "bad-extra", INJECTED: "evil",
    }));

  await deny("21 slots (oversized) rejected",
    favA("bad-21slots").set({
      id:        "bad-21slots",
      title:     "Too many slots",
      slots:     Array.from({ length: 21 }, (_, i) => ({ matched: false, genericText: `s${i}` })),
      items:     [],
      tempC:     16,
      condition: "Clear",
      savedAt:   now,
    }));

  await deny("21 items (oversized) rejected",
    favA("bad-21items").set({
      id:        "bad-21items",
      title:     "Too many items",
      items:     Array.from({ length: 21 }, (_, i) => `item-${i}`),
      tempC:     16,
      condition: "Clear",
      savedAt:   now,
    }));

  await deny("Title 257 chars rejected",
    favA("bad-title").set({
      ...legacyCloudRecord, id: "bad-title", title: "A".repeat(257),
    }));

  await deny("ID 129 chars rejected",
    favA("A".repeat(129)).set({
      ...legacyCloudRecord, id: "A".repeat(129),
    }));

  await deny("tempC not a number rejected",
    favA("bad-tempc").set({
      ...legacyCloudRecord, id: "bad-tempc", tempC: "hot",
    }));

  await deny("savedAt not a number rejected",
    favA("bad-savedat").set({
      ...legacyCloudRecord, id: "bad-savedat", savedAt: "yesterday",
    }));

  // ── 4. Admin-only paths ───────────────────────────────────────────────────
  console.log("\n── 4. Admin-only paths ───────────────────────────────────────");

  const checkoutRef  = dbA.collection("users").doc("uid-alice").collection("checkout").doc("pending");
  const consentRef   = dbA.collection("users").doc("uid-alice").collection("consentRecords").doc("cs_test");
  const pendingRef   = dbA.collection("users").doc("uid-alice").collection("pendingDeletion").doc("request");
  const deletionJob  = dbA.collection("deletionJobs").doc("job-test");
  const reservRef    = dbA.collection("users").doc("uid-alice").collection("quotaReservations").doc("res-1");

  await deny("Client cannot read checkout/pending",    checkoutRef.get());
  await deny("Client cannot write checkout/pending",   checkoutRef.set({
    state: "creating", leaseToken: "tok", expiresAt: now + 30000, createdAt: now,
  }));
  await deny("Client cannot read consentRecords",      consentRef.get());
  await deny("Client cannot write consentRecords",     consentRef.set({ uid: "uid-alice", sessionId: "cs_x" }));
  await deny("Client cannot read pendingDeletion",     pendingRef.get());
  await deny("Client cannot write pendingDeletion",    pendingRef.set({ jobId: "j1", uid: "uid-alice" }));
  await deny("Client cannot read deletionJobs",        deletionJob.get());
  await deny("Client cannot write deletionJobs",       deletionJob.set({
    jobId: "job-test", uid: "uid-alice", status: "pending",
  }));
  await deny("Bob cannot read Alice's checkout",
    dbB.collection("users").doc("uid-alice").collection("checkout").doc("pending").get());
  await deny("Bob cannot read Alice's pendingDeletion",
    dbB.collection("users").doc("uid-alice").collection("pendingDeletion").doc("request").get());

  // ── 5. Quota reservation paths ────────────────────────────────────────────
  console.log("\n── 5. Quota reservations ─────────────────────────────────");
  await deny("Client cannot read quotaReservations", reservRef.get());
  await deny("Client cannot write quotaReservations", reservRef.set({
    reservationId: "res-1", uid: "uid-alice", isPremium: false,
    reservedDate: "2026-08-26", reservedRolling30StartMs: null,
    reservedFree: true, reservedDaily: false, reservedRolling: false,
    status: "reserved", createdAt: Date.now(), finalizedAt: null,
  }));
  await deny("Bob cannot read Alice's quotaReservations",
    dbB.collection("users").doc("uid-alice").collection("quotaReservations").doc("res-1").get());

  await env.cleanup();


  console.log(`\n${pass + fail} tests: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
