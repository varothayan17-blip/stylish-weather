/**
 * In-memory mock store for the Wardrobe UI prototype.
 *
 * No persistence, no Firestore, no network. State lives for the session only
 * so the UI can be demoed. Uses useSyncExternalStore — no new state library.
 */
import { useSyncExternalStore } from "react";
import { SEED_ITEMS, type WardrobeItem } from "./wardrobeData";

let items: WardrobeItem[] = [...SEED_ITEMS];
const listeners = new Set<() => void>();

function emit() {
  items = [...items];
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  return items;
}

export function useWardrobe() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export const wardrobe = {
  add(item: Omit<WardrobeItem, "id">) {
    items.push({ ...item, id: `item-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` });
    emit();
  },
  update(id: string, patch: Partial<WardrobeItem>) {
    items = items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    emit();
  },
  remove(id: string) {
    items = items.filter((i) => i.id !== id);
    emit();
  },
  clear() {
    items = [];
    emit();
  },
};
