/**
 * Memory confidentiality: hide confidential rows from low-privilege readers.
 * @see docs/CODE_REVIEW_REMEDIATION_PLAN.md
 */

import { roleMeets } from '@/lib/authz';

export function canViewConfidentialMemory(ctx) {
  return roleMeets(ctx.role, 'operator');
}

/** Filter list / retrieve results */
export function filterMemoryRowsForReader(rows, ctx) {
  if (!Array.isArray(rows)) return [];
  if (canViewConfidentialMemory(ctx)) return rows;
  return rows.filter((r) => r.sensitivity !== 'confidential');
}

/** Single-row: return null if must not be disclosed (avoid existence leak use 404). */
export function memoryRowVisibleToReader(row, ctx) {
  if (!row) return null;
  if (row.sensitivity === 'confidential' && !canViewConfidentialMemory(ctx)) {
    return null;
  }
  return row;
}
