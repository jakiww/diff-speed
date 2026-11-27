// A faster drop-in for makefun-diff 1.0.0.
//
// The rule it reproduces, exactly: split each text into lines after every "\n"
// (a last line without one is a line too), trim the common prefix of lines and
// then the common suffix, and between them run Myers's greedy search, keeping
// on each diagonal the path furthest into the old text, preferring a deletion
// when a deletion and an insertion reach the same point, never stepping past
// either text's end, and following every run of equal lines as far as it goes.
// The first path to reach both ends is the edit script; the patch is then
// built with up to 3 kept lines around each change run, runs at most 6 kept
// lines apart sharing a hunk, deletions listed before insertions, and "%"
// after a line that ends its text with no newline.
//
// How this stays fast while matching that rule bit for bit:
//   - every line is hashed to one integer once, so the hot loop compares ints,
//     never strings, and the tokenizer slices lines out of the text instead
//     of building new strings for them;
//   - the search keeps only the furthest x per (depth, diagonal), one small
//     Int32Array row per depth, no path objects and no linked lists at all
//     (the baseline allocates a path object plus a component object per
//     step), with the two edge diagonals handled outside the inner loop;
//     the rows together hold about D squared over 2 integers, D the edit
//     distance, which stays near a few thousand on the drawn cases;
//   - the script is recovered afterwards by walking those stored rows back
//     down with the same tie-break the forward pass used, so the recovered
//     script is the same first path the baseline's search returns.

const FORMAT = 'makefun-diff/1';
const CONTEXT = 3;
const KEEP = '=';
const DELETE = '-';
const INSERT = '+';

/** Split a text into its lines, each keeping its "\n" except a bare last line. */
function tokenize(text) {
  const lines = [];
  let start = 0;
  for (;;) {
    const idx = text.indexOf('\n', start);
    if (idx < 0) {
      if (start < text.length) lines.push(text.slice(start));
      break;
    }
    lines.push(text.slice(start, idx + 1));
    start = idx + 1;
  }
  return lines;
}

/**
 * The edit runs of the middle slices, as [{ kind, count }] in order.
 * a and b hold line ids (equal lines share an id), already prefix/suffix
 * trimmed. The search stores one row of furthest x per depth, then walks
 * the rows back down to recover the exact first path.
 */
function editRuns(a, b) {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  const rows = [];
  // Depth 0: the opening snake from (0, 0).
  let x = 0;
  while (x < n && x < m && a[x] === b[x]) x++;
  const first = new Int32Array(1);
  first[0] = x;
  rows[0] = first;
  if (x === n && x === m) return x > 0 ? [{ kind: KEEP, count: x }] : [];

  const maxEdit = n + m;
  let foundD = -1;
  let foundJ = -1;
  let prev = first;
  for (let d = 1; d <= maxEdit; d++) {
    const cur = new Int32Array(d + 1);
    let done = false;
    // Diagonal k = -d: only the insertion from the previous row's first entry.
    {
      const k = -d;
      const vIns = prev[0];
      if (vIns >= 0 && vIns - (k + 1) < m) {
        let xx = vIns;
        while (xx < n && xx - k < m && a[xx] === b[xx - k]) xx++;
        cur[0] = xx;
        if (xx === n && xx - k === m) {
          foundD = d;
          foundJ = 0;
          done = true;
        }
      } else {
        cur[0] = -1;
      }
    }
    if (!done) {
      for (let j = 1; j < d; j++) {
        const k = 2 * j - d;
        const vDel = prev[j - 1];
        const vIns = prev[j];
        const canDel = vDel >= 0 && vDel < n;
        const canIns = vIns >= 0 && vIns - (k + 1) < m;
        let xPre;
        // Deletion wins the tie: it reaches vDel + 1, the insertion vIns.
        if (canDel) xPre = !canIns || vDel + 1 >= vIns ? vDel + 1 : vIns;
        else if (canIns) xPre = vIns;
        else {
          cur[j] = -1;
          continue;
        }
        let xx = xPre;
        // The snake: every line equal in both, as far as it goes.
        while (xx < n && xx - k < m && a[xx] === b[xx - k]) xx++;
        cur[j] = xx;
        if (xx === n && xx - k === m) {
          foundD = d;
          foundJ = j;
          done = true;
          break;
        }
      }
    }
    if (!done) {
      // Diagonal k = d: only the deletion from the previous row's last entry.
      const k = d;
      const vDel = prev[d - 1];
      if (vDel >= 0 && vDel < n) {
        let xx = vDel + 1;
        while (xx < n && xx - k < m && a[xx] === b[xx - k]) xx++;
        cur[d] = xx;
        if (xx === n && xx - k === m) {
          foundD = d;
          foundJ = d;
          done = true;
        }
      } else {
        cur[d] = -1;
      }
    }
    rows[d] = cur;
    prev = cur;
    if (done) break;
  }
  if (foundD < 0) throw new Error('diff: the search ended without reaching both ends');

  // Walk back down from the first path to reach both ends, undoing one edit
  // and its snake per depth, with the forward pass's own tie-break.
  const ops = [];
  let j = foundJ;
  let cx = n;
  for (let d = foundD; d >= 1; d--) {
    const k = 2 * j - d;
    const row = rows[d - 1];
    const vDel = j > 0 ? row[j - 1] : -1;
    const vIns = j < d ? row[j] : -1;
    const canDel = vDel >= 0 && vDel < n;
    const canIns = vIns >= 0 && vIns - (k + 1) < m;
    let xPre;
    let prevJ;
    let kind;
    if (canDel && (!canIns || vDel + 1 >= vIns)) {
      xPre = vDel + 1;
      prevJ = j - 1;
      kind = DELETE;
    } else {
      xPre = vIns;
      prevJ = j;
      kind = INSERT;
    }
    if (cx > xPre) ops.push({ kind: KEEP, count: cx - xPre });
    ops.push({ kind, count: 1 });
    cx = row[prevJ];
    j = prevJ;
  }
  if (cx > 0) ops.push({ kind: KEEP, count: cx });

  // The walk collected the script backwards; reverse it and merge runs of
  // one kind, the way the baseline's path components merge.
  const runs = [];
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    const last = runs[runs.length - 1];
    if (last !== undefined && last.kind === op.kind) last.count += op.count;
    else runs.push({ kind: op.kind, count: op.count });
  }
  return runs;
}

/** A line as the patch writes it: its op, the line, a newline, "%" if it had none. */
function written(op, line) {
  return line.endsWith('\n') ? op + line : op + line + '\n%\n';
}

/** make.fun's own patch of input.old into input.new, as one string. */
export function run(input) {
  if (input === null || typeof input !== 'object' || typeof input.old !== 'string' || typeof input.new !== 'string') {
    throw new TypeError('diff: the input is { old, new }, two strings');
  }
  const a = tokenize(input.old);
  const b = tokenize(input.new);
  const n = a.length;
  const m = b.length;

  // Hash every line to one integer, one shared table per call so equal
  // lines in the two texts share an id.
  const ids = new Map();
  const ah = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const line = a[i];
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    ah[i] = id;
  }
  const bh = new Int32Array(m);
  for (let i = 0; i < m; i++) {
    const line = b[i];
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    bh[i] = id;
  }

  // The common prefix, then the common suffix of what is left.
  let prefix = 0;
  while (prefix < n && prefix < m && ah[prefix] === bh[prefix]) prefix++;
  let suffix = 0;
  while (suffix < n - prefix && suffix < m - prefix && ah[n - 1 - suffix] === bh[m - 1 - suffix]) suffix++;

  const runs = [];
  if (prefix > 0) runs.push({ kind: KEEP, count: prefix });
  runs.push(...editRuns(ah.subarray(prefix, n - suffix), bh.subarray(prefix, m - suffix)));
  if (suffix > 0) runs.push({ kind: KEEP, count: suffix });

  // The change runs: each a stretch of deletions and insertions between two
  // kept lines, at old line o and new line p.
  const changes = [];
  let o = 0;
  let p = 0;
  let deleted = 0;
  let inserted = 0;
  for (const r of runs) {
    if (r.kind === KEEP) {
      o += r.count;
      p += r.count;
      continue;
    }
    let c = changes[changes.length - 1];
    if (c === undefined || c.o + c.dels !== o || c.p + c.ins !== p) {
      c = { o, p, dels: 0, ins: 0 };
      changes.push(c);
    }
    if (r.kind === DELETE) {
      c.dels += r.count;
      o += r.count;
      deleted += r.count;
    } else {
      c.ins += r.count;
      p += r.count;
      inserted += r.count;
    }
  }

  // The hunks: change runs at most 2 * CONTEXT kept lines apart share one.
  const hunks = [];
  for (const c of changes) {
    const h = hunks[hunks.length - 1];
    const prev = h !== undefined ? h[h.length - 1] : undefined;
    if (prev !== undefined && c.o - (prev.o + prev.dels) <= 2 * CONTEXT) h.push(c);
    else hunks.push([c]);
  }

  const out = [`${FORMAT} old=${n} new=${m} hunks=${hunks.length} deleted=${deleted} inserted=${inserted}\n`];
  for (const h of hunks) {
    const first = h[0];
    const last = h[h.length - 1];
    const oldStart = Math.max(0, first.o - CONTEXT);
    const newStart = first.p - (first.o - oldStart);
    const after = Math.min(CONTEXT, n - (last.o + last.dels));
    const oldEnd = last.o + last.dels + after;
    const newEnd = last.p + last.ins + after;
    out.push(`@ ${oldStart + 1} ${oldEnd - oldStart} ${newStart + 1} ${newEnd - newStart}\n`);
    let at = oldStart;
    for (const c of h) {
      for (; at < c.o; at++) out.push(written(KEEP, a[at]));
      for (let i = 0; i < c.dels; i++) out.push(written(DELETE, a[c.o + i]));
      for (let i = 0; i < c.ins; i++) out.push(written(INSERT, b[c.p + i]));
      at = c.o + c.dels;
    }
    for (; at < oldEnd; at++) out.push(written(KEEP, a[at]));
  }
  return out.join('');
}
