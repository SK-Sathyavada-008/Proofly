// ─────────────────────────────────────────────
// firestoreUtils.ts — Shared Firestore Helper Utilities
// ─────────────────────────────────────────────

/**
 * Strips all undefined properties recursively from objects before writing to Firestore.
 * Prevents Firestore "Unsupported field value: undefined (found in field ...)" errors.
 */
export function sanitizeFirestoreData<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) {
    return obj.map(sanitizeFirestoreData) as any;
  }
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const clean: any = {};
    for (const [key, val] of Object.entries(obj)) {
      if (val !== undefined) {
        clean[key] = sanitizeFirestoreData(val);
      }
    }
    return clean;
  }
  return obj;
}
