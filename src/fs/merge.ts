// merge.ts — minimal line-based three-way merge (diff3-style).
//
// Used to reconcile an external on-disk change with the user's unsaved edits:
// given the common base (the last-synced disk content), the local buffer and
// the remote (new disk) content, produce a merged result when the two sides
// touched disjoint lines, or report a conflict when they edited the same lines.
//
// Granularity is per-line, matching how git's default merge behaves: two edits
// to the same line are a conflict even if "logically" disjoint. That keeps the
// auto-merge conservative — anything ambiguous falls back to the user prompt.

/** Longest common subsequence of a and b as aligned index pairs [ai, bi]. */
function lcsPairs(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length
  const m = b.length
  // dp[i][j] = LCS length of a[i:] and b[j:]. O(n*m); fine for note-sized files.
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const pairs: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pairs.push([i, j])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return pairs
}

function eqSeg(x: string[], y: string[]): boolean {
  return x.length === y.length && x.every((v, k) => v === y[k])
}

export interface MergeResult {
  /** True when local and remote edits were disjoint and merged cleanly. */
  ok: boolean
  /** The merged text (only meaningful when ok). */
  text: string
}

/**
 * Three-way merge of line-based text. Returns `ok: true` with the merged text
 * when the local and remote edits don't overlap, otherwise `ok: false`.
 *
 * Splitting and rejoining on "\n" round-trips exactly, so trailing newlines and
 * blank lines are preserved.
 */
export function merge3(base: string, local: string, remote: string): MergeResult {
  const B = base.split('\n')
  const L = local.split('\n')
  const R = remote.split('\n')

  // Where each base line lands in local / remote (if it survived unchanged).
  const baseToLocal = new Map<number, number>()
  for (const [bi, li] of lcsPairs(B, L)) baseToLocal.set(bi, li)
  const baseToRemote = new Map<number, number>()
  for (const [bi, ri] of lcsPairs(B, R)) baseToRemote.set(bi, ri)

  // Anchors: base lines preserved in BOTH sides, strictly advancing in each —
  // these are the points all three versions agree on. Regions between anchors
  // are where edits live.
  const anchors: Array<{ b: number; l: number; r: number }> = []
  let lastL = -1
  let lastR = -1
  for (let bi = 0; bi < B.length; bi++) {
    const li = baseToLocal.get(bi)
    const ri = baseToRemote.get(bi)
    if (li != null && ri != null && li > lastL && ri > lastR) {
      anchors.push({ b: bi, l: li, r: ri })
      lastL = li
      lastR = ri
    }
  }

  const out: string[] = []
  let pb = 0
  let pl = 0
  let pr = 0
  let conflict = false

  const emitRegion = (bEnd: number, lEnd: number, rEnd: number): void => {
    const baseSeg = B.slice(pb, bEnd)
    const localSeg = L.slice(pl, lEnd)
    const remoteSeg = R.slice(pr, rEnd)
    if (eqSeg(localSeg, baseSeg)) {
      out.push(...remoteSeg) // only remote changed here
    } else if (eqSeg(remoteSeg, baseSeg)) {
      out.push(...localSeg) // only local changed here
    } else if (eqSeg(localSeg, remoteSeg)) {
      out.push(...localSeg) // both made the same change
    } else {
      conflict = true // both changed this region differently
    }
  }

  for (const a of anchors) {
    emitRegion(a.b, a.l, a.r)
    if (conflict) break
    out.push(B[a.b]) // the shared anchor line
    pb = a.b + 1
    pl = a.l + 1
    pr = a.r + 1
  }
  if (!conflict) emitRegion(B.length, L.length, R.length) // trailing region

  return conflict ? { ok: false, text: '' } : { ok: true, text: out.join('\n') }
}
