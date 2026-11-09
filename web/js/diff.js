// Diff de líneas (LCS) para mostrar qué cambia antes de aprobar una edición.
export function lineDiff(before, after, context = 3) {
  const a = (before ?? '').split('\n');
  const b = (after ?? '').split('\n');
  if (a.length * b.length > 4e6) {
    return [{ t: '-', s: `(${a.length} líneas)` }, { t: '+', s: `(${b.length} líneas; archivo demasiado grande para diff)` }];
  }
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  }
  const ops = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: ' ', s: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push({ t: '-', s: a[i++] });
    else ops.push({ t: '+', s: b[j++] });
  }
  while (i < n) ops.push({ t: '-', s: a[i++] });
  while (j < m) ops.push({ t: '+', s: b[j++] });

  // recorta las líneas iguales lejos de un cambio
  const keep = ops.map((o, k) => o.t !== ' ' || ops.slice(Math.max(0, k - context), k + context + 1).some((x) => x.t !== ' '));
  const out = [];
  let skipped = 0;
  ops.forEach((o, k) => {
    if (keep[k]) {
      if (skipped) { out.push({ t: '@', s: `… ${skipped} líneas sin cambios` }); skipped = 0; }
      out.push(o);
    } else skipped++;
  });
  if (skipped) out.push({ t: '@', s: `… ${skipped} líneas sin cambios` });
  return out;
}

export function diffStats(ops) {
  return { add: ops.filter((o) => o.t === '+').length, del: ops.filter((o) => o.t === '-').length };
}
