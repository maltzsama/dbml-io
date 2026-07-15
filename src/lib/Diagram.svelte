<script lang="ts">
  import { onMount, tick } from 'svelte';
  import * as htmlToImage from 'html-to-image';
  import type { CompiledDBML, Table, TableField } from './parser';

  let { data, theme, lineMode = 'ortho', showLegend = true }: {
    data: CompiledDBML;
    theme: string;
    lineMode?: string;
    showLegend?: boolean;
  } = $props();

  // --- Plain JS state (NOT reactive — no re-renders on change) ---
  let zoom = 1, panX = 0, panY = 0;
  let isPan = false;
  let dragTarget: string | null = null;
  let psx = 0, psy = 0, ppx = 0, ppy = 0, dox = 0, doy = 0;
  let hovTable: string | null = null, hovField: string | null = null;
  let rafId = 0;

  // --- Minimal $state (only what the template actually binds to) ---
  let zoomPct = $state(100);
  let tipVis = $state(false);
  let tipX = $state(0);
  let tipY = $state(0);
  let tipHtml = $state('');

  let worldEl: HTMLDivElement | undefined = $state();
  let canvasEl: HTMLDivElement | undefined = $state();
  let svgEl: SVGSVGElement | undefined = $state();
  let svgW = $state(8000);
  let svgH = $state(8000);

  let lineAdj = $state<Record<number, number>>({});
  let dragLine: number | null = null;

  let searchQuery = $state('');
  let searchInput: HTMLInputElement | undefined = $state();
  let searchFocused = $state(false);

  let visibleTables = $derived(
    searchQuery
      ? data.tables.filter(t => {
          const q = searchQuery.toLowerCase();
          if (t.name.toLowerCase().includes(q)) return true;
          return t.fields.some(f => f.name.toLowerCase().includes(q) || f.type.toLowerCase().includes(q));
        })
      : data.tables
  );

  // Debounced draw — max 1 per frame
  function schedDraw() {
    cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(drawLines);
  }

  function applyTf() {
    if (worldEl) worldEl.style.transform = `translate(${panX}px,${panY}px) scale(${zoom})`;
  }

  // Redraw on data, lineMode, or search changes
  $effect(() => { data; lineMode; searchQuery; schedDraw(); });

  onMount(() => {
    const onMove = (e: MouseEvent) => handleMove(e);
    const onUp = () => handleUp();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    window.addEventListener('resize', schedDraw);
    function onDocKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInput?.focus();
        searchInput?.select();
      }
      if (e.key === 'Escape' && searchFocused) {
        searchQuery = '';
        searchInput?.blur();
      }
    }
    document.addEventListener('keydown', onDocKey);
    setTimeout(fitAll, 100);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onDocKey);
      window.removeEventListener('resize', schedDraw);
    };
  });

  export function executeAction(a: string) {
    if (a === 'fit') fitAll();
    if (a === 'svg') doExportSVG();
    if (a === 'png') doExportPNG();
  }

  function updateSvgSize() {
    if (!worldEl) return;
    const cards = worldEl.querySelectorAll<HTMLElement>('.tcard');
    if (!cards.length) { svgW = 8000; svgH = 8000; return; }
    let mx = 0, my = 0;
    cards.forEach(c => {
      const x = parseFloat(c.style.left) || 0;
      const y = parseFloat(c.style.top) || 0;
      mx = Math.max(mx, x + c.offsetWidth);
      my = Math.max(my, y + c.offsetHeight);
    });
    const pad = 200;
    svgW = Math.ceil(mx + pad);
    svgH = Math.ceil(my + pad);
  }

  // ==== LINE DRAWING ====
  function drawLines() {
    if (!svgEl || !worldEl) return;
    updateSvgSize();
    const refs = data?.refs;
    if (!refs?.length) { svgEl.innerHTML = ''; return; }

    const wr = worldEl.getBoundingClientRect();
    const z = zoom;

    // ── Pass 1: compute port positions per ref ──
    type Rd = { sx: number; sy: number; ex: number; ey: number; dirS: number; dirE: number };
    const rds: (Rd | null)[] = [];

    for (let i = 0; i < refs.length; i++) {
      const r = refs[i];
      const fc = worldEl.querySelector(`.tcard[data-t="${r.fromTable}"]`);
      const tc = worldEl.querySelector(`.tcard[data-t="${r.toTable}"]`);
      if (!fc || !tc) { rds.push(null); continue; }
      const fr = fc.querySelector(`.frow[data-f="${r.fromField}"]`);
      const tr = tc.querySelector(`.frow[data-f="${r.toField}"]`);
      if (!fr || !tr) { rds.push(null); continue; }

      const fcr = fc.getBoundingClientRect(), tcr = tc.getBoundingClientRect();
      const frr = fr.getBoundingClientRect(), trr = tr.getBoundingClientRect();
      const fcx = (fcr.left + fcr.right) * 0.5, tcx = (tcr.left + tcr.right) * 0.5;

      let sx: number, ex: number, dirS: number, dirE: number;
      if (fcx >= tcx) { sx = (fcr.left - wr.left) / z; ex = (tcr.right - wr.left) / z; dirS = -1; dirE = 1; }
      else            { sx = (fcr.right - wr.left) / z; ex = (tcr.left - wr.left) / z; dirS = 1; dirE = -1; }
      const sy = (frr.top + frr.height * 0.5 - wr.top) / z;
      const ey = (trr.top + trr.height * 0.5 - wr.top) / z;

      rds.push({ sx, sy, ex, ey, dirS, dirE });
    }

    // ── Pass 2: grid route + nudge + draw ──
    // Collect table bounding boxes (original, no padding — padding applied in the router)
    const tRects: { t: string; x1: number; y1: number; x2: number; y2: number }[] = [];
    for (const card of worldEl.querySelectorAll('.tcard')) {
      const t = (card as HTMLElement).dataset.t;
      if (!t) continue;
      const cr = card.getBoundingClientRect();
      tRects.push({ t, x1: (cr.left - wr.left) / z, y1: (cr.top - wr.top) / z, x2: (cr.right - wr.left) / z, y2: (cr.bottom - wr.top) / z });
    }

    // Route each ref through the grid router
    const routed: { pts: Pt[]; i: number }[] = [];
    for (let i = 0; i < refs.length; i++) {
      const rd = rds[i];
      if (!rd) continue;
      const r = refs[i];
      const obs = tRects.filter(o => o.t !== r.fromTable && o.t !== r.toTable);
      const path = routeRef(rd.sx, rd.sy, rd.ex, rd.ey, rd.dirS, rd.dirE, obs);
      const adj = lineAdj[i] ?? 0;
      if (adj !== 0) for (let j = 1; j < path.length - 1; j++) path[j].x += adj;
      routed.push({ pts: path, i });
    }

    // Nudge shared horizontal segments apart
    nudgePaths(routed.map(p => p.pts));

    // Render
    let out = '';
    for (const { pts: path, i } of routed) {
      const rd = rds[i]!;
      const r = refs[i];
      const sp = lineMode === 'ortho' ? simplify(path) : path;
      const d = lineMode === 'ortho' ? roundPolyline(sp, 6) : '';
      const hi = hovTable && ((r.fromTable === hovTable && r.fromField === hovField) || (r.toTable === hovTable && r.toField === hovField));
      const h = hi ? ' hi' : '';
      const dl = dragLine === i ? ' dl' : '';

      if (lineMode === 'ortho') {
        out += `<path d="${d}" class="rel-bg" data-ref="${i}"/>`;
        out += `<path d="${d}" class="rel${h}"/>`;
        const mid = Math.floor(sp.length / 2);
        if (hi || dl) out += `<circle cx="${sp[mid].x}" cy="${sp[mid].y}" r="5" class="lhandle${dl}" data-ref="${i}"/>`;
      } else {
        const cp = Math.max(50, Math.abs(rd.ex - rd.sx) * 0.35);
        const bd = `M${rd.sx} ${rd.sy}C${rd.sx < rd.ex ? rd.sx + cp : rd.sx - cp} ${rd.sy},${rd.sx < rd.ex ? rd.ex - cp : rd.ex + cp} ${rd.ey},${rd.ex} ${rd.ey}`;
        out += `<path d="${bd}" class="rel-bg" data-ref="${i}"/>`;
        out += `<path d="${bd}" class="rel${h}"/>`;
      }

      out += `<circle cx="${rd.sx}" cy="${rd.sy}" r="3.5" class="rdot${h}"/>`;
      out += `<circle cx="${rd.ex}" cy="${rd.ey}" r="3.5" class="rdot${h}"/>`;
      const cs = csym(r.type || '>');
      if (cs[0]) out += `<text x="${rd.sx + (rd.sx < rd.ex ? 14 : -14)}" y="${rd.sy - 8}" text-anchor="${rd.sx < rd.ex ? 'start' : 'end'}" class="clbl${h}">${cs[0]}</text>`;
      if (cs[1]) out += `<text x="${rd.ex + (rd.sx < rd.ex ? -14 : 14)}" y="${rd.ey - 8}" text-anchor="${rd.sx < rd.ex ? 'end' : 'start'}" class="clbl${h}">${cs[1]}</text>`;
    }
    svgEl.innerHTML = out;
  }

  // ── Routing engine ──
  type Pt = { x: number; y: number };
  interface TabBox { t?: string; x1: number; y1: number; x2: number; y2: number }

  /** Check whether an axis-aligned segment strictly crosses any box. */
  function segHit(x1: number, y1: number, x2: number, y2: number, boxes: TabBox[], pad = 0): boolean {
    if (y1 === y2) {
      const xL = Math.min(x1, x2), xR = Math.max(x1, x2);
      for (const b of boxes) {
        if (y1 > b.y1 - pad && y1 < b.y2 + pad && xL < b.x2 + pad && xR > b.x1 - pad) return true;
      }
    } else if (x1 === x2) {
      const yT = Math.min(y1, y2), yB = Math.max(y1, y2);
      for (const b of boxes) {
        if (x1 > b.x1 - pad && x1 < b.x2 + pad && yT < b.y2 + pad && yB > b.y1 - pad) return true;
      }
    }
    return false;
  }

  /**
   * Orthogonal grid router (visibility graph + Dijkstra with bend penalty).
   * Ports get a mandatory perpendicular STUB so the line never turns right at
   * the table edge. Routing happens between the stub tips; the real port points
   * are prepended/appended so anchors always sit on the column row.
   */
  function routeRef(sx: number, sy: number, ex: number, ey: number, dirS: number, dirE: number, obstacles: TabBox[]): Pt[] {
    const PAD = 12, STUB = 16;
    const ax = sx + STUB * dirS, ay = sy;
    const bx = ex + STUB * dirE, by = ey;

    const xs = new Set<number>([ax, bx]);
    const ys = new Set<number>([ay, by]);
    for (const o of obstacles) {
      xs.add(o.x1 - PAD); xs.add(o.x1); xs.add(o.x2); xs.add(o.x2 + PAD);
      ys.add(o.y1 - PAD); ys.add(o.y1); ys.add(o.y2); ys.add(o.y2 + PAD);
    }
    const xArr = [...xs].sort((a, b) => a - b);
    const yArr = [...ys].sort((a, b) => a - b);
    const cols = xArr.length, rows = yArr.length, N = cols * rows;

    function blocked(x: number, y: number): boolean {
      for (const o of obstacles) {
        if (x > o.x1 - PAD && x < o.x2 + PAD && y > o.y1 - PAD && y < o.y2 + PAD) return true;
      }
      return false;
    }
    function idx(arr: number[], v: number): number {
      let best = 0, bd = Infinity;
      for (let i = 0; i < arr.length; i++) { const d = Math.abs(arr[i] - v); if (d < bd) { bd = d; best = i; } }
      return best;
    }

    const si = idx(xArr, ax), sj = idx(yArr, ay);
    const ei = idx(xArr, bx), ej = idx(yArr, by);
    const start = sj * cols + si, end = ej * cols + ei;

    const dist = new Float64Array(N).fill(1e9);
    const prev = new Int32Array(N).fill(-1);
    const prevDir = new Int8Array(N).fill(-1);
    dist[start] = 0;
    const open = new Set<number>([start]);
    const BEND_COST = 400;

    while (open.size > 0) {
      let minD = 1e10, u = -1;
      for (const v of open) { if (dist[v] < minD) { minD = dist[v]; u = v; } }
      if (u === -1 || u === end) break;
      open.delete(u);

      const ui = u % cols, uj = Math.floor(u / cols);
      const ux = xArr[ui], uy = yArr[uj];

      const dirs: [number, number, number][] = [[ui - 1, uj, 0], [ui + 1, uj, 0], [ui, uj - 1, 1], [ui, uj + 1, 1]];
      for (const [vi, vj, dir] of dirs) {
        if (vi < 0 || vi >= cols || vj < 0 || vj >= rows) continue;
        const vx = xArr[vi], vy = yArr[vj];
        if (blocked(vx, vy)) continue;
        if (segHit(ux, uy, vx, vy, obstacles, PAD)) continue;

        const v = vj * cols + vi;
        let cost = Math.abs(vx - ux) + Math.abs(vy - uy);
        if (prevDir[u] !== -1 && prevDir[u] !== dir) cost += BEND_COST;
        const nd = dist[u] + cost;
        if (nd < dist[v]) { dist[v] = nd; prev[v] = u; prevDir[v] = dir; open.add(v); }
      }
    }

    let core: Pt[];
    if (dist[end] >= 1e9) {
      const mx = (ax + bx) / 2;
      core = [{ x: ax, y: ay }, { x: mx, y: ay }, { x: mx, y: by }, { x: bx, y: by }];
    } else {
      core = [];
      let cur = end;
      while (cur !== -1) { core.unshift({ x: xArr[cur % cols], y: yArr[Math.floor(cur / cols)] }); cur = prev[cur]; }
    }

    return [{ x: sx, y: sy }, ...core, { x: ex, y: ey }];
  }

  /**
   * Nudge overlapping horizontal segments apart into parallel lanes.
   * Only interior segments are moved — the first/last segments carry the port
   * anchors and must never shift, or the line detaches from the column row.
   */
  function nudgePaths(paths: Pt[][]): void {
    const NUDGE = 9;
    type Seg = { pi: number; si: number; y: number; x1: number; x2: number };
    const segs: Seg[] = [];

    for (let pi = 0; pi < paths.length; pi++) {
      const p = paths[pi];
      for (let si = 1; si <= p.length - 3; si++) {
        if (p[si].y === p[si + 1].y) {
          segs.push({ pi, si, y: p[si].y, x1: Math.min(p[si].x, p[si + 1].x), x2: Math.max(p[si].x, p[si + 1].x) });
        }
      }
    }

    const byY = new Map<number, Seg[]>();
    for (const s of segs) { const k = Math.round(s.y); if (!byY.has(k)) byY.set(k, []); byY.get(k)!.push(s); }

    for (const [, group] of byY) {
      if (group.length < 2) continue;
      group.sort((a, b) => a.x1 - b.x1);

      const used = new Array(group.length).fill(false);
      for (let a = 0; a < group.length; a++) {
        if (used[a]) continue;
        const cluster: Seg[] = [group[a]];
        used[a] = true;
        let grew = true;
        while (grew) {
          grew = false;
          for (let b = 0; b < group.length; b++) {
            if (used[b]) continue;
            if (cluster.some(c => c.x2 > group[b].x1 && group[b].x2 > c.x1)) {
              cluster.push(group[b]); used[b] = true; grew = true;
            }
          }
        }
        if (cluster.length < 2) continue;

        const n = cluster.length;
        cluster.forEach((s, li) => {
          const off = (li - (n - 1) / 2) * NUDGE;
          const p = paths[s.pi];
          p[s.si].y += off;
          p[s.si + 1].y += off;
        });
      }
    }
  }

  /** Remove duplicate and collinear points so corner rounding stays clean. */
  function simplify(pts: Pt[]): Pt[] {
    const out: Pt[] = [];
    for (const p of pts) {
      const n = out.length;
      if (n && out[n - 1].x === p.x && out[n - 1].y === p.y) continue;
      if (n >= 2) {
        const a = out[n - 2], b = out[n - 1];
        if ((a.x === b.x && b.x === p.x) || (a.y === b.y && b.y === p.y)) { out[n - 1] = p; continue; }
      }
      out.push({ x: p.x, y: p.y });
    }
    return out;
  }

  /** Round every interior corner of an orthogonal polyline with Q-bezier arcs. */
  function roundPolyline(pts: Pt[], r: number): string {
    if (pts.length < 2) return '';
    let d = `M${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i - 1], c = pts[i], n = pts[i + 1];
      const len1 = Math.abs(c.x - p.x) + Math.abs(c.y - p.y);
      const len2 = Math.abs(n.x - c.x) + Math.abs(n.y - c.y);
      const rr = Math.min(r, len1 * 0.49, len2 * 0.49);
      if (rr <= 0) { d += `L${c.x} ${c.y}`; continue; }

      let ax: number, ay: number, bx: number, by: number;
      if (c.x === p.x) {
        ax = c.x; ay = c.y - Math.sign(c.y - p.y) * rr;
        bx = c.x + Math.sign(n.x - c.x) * rr; by = c.y;
      } else {
        ax = c.x - Math.sign(c.x - p.x) * rr; ay = c.y;
        bx = c.x; by = c.y + Math.sign(n.y - c.y) * rr;
      }
      d += `L${ax} ${ay}Q${c.x} ${c.y} ${bx} ${by}`;
    }
    d += `L${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`;
    return d;
  }

  function csym(t: string): [string, string] {
    return t === '>' ? ['*', '1'] : t === '<' ? ['1', '*'] : t === '-' ? ['1', '1'] : t === '<>' ? ['*', '*'] : ['', ''];
  }

  // ==== LINE DRAG (SVG child delegation) ====
  function svgDown(e: MouseEvent) {
    if (e.button !== 0) return;
    const el = e.target as Element;
    const r = el.getAttribute('data-ref');
    if (r !== null) {
      const idx = parseInt(r);
      if (!isNaN(idx)) {
        e.stopPropagation();
        dragLine = idx;
        if (!(idx in lineAdj)) lineAdj[idx] = 0;
      }
    }
  }

  // ==== CANVAS PAN ====
  function canvasDown(e: MouseEvent) {
    if (e.button !== 0) return;
    if (dragTarget) return;
    isPan = true;
    psx = e.clientX; psy = e.clientY;
    ppx = panX; ppy = panY;
    if (canvasEl) canvasEl.style.cursor = 'grabbing';
  }

  // ==== DRAG TABLE CARD ====
  function startDrag(e: MouseEvent, name: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    dragTarget = name;
    const card = (e.currentTarget as HTMLElement).closest('.tcard') as HTMLElement;
    const r = card.getBoundingClientRect();
    dox = (e.clientX - r.left) / zoom;
    doy = (e.clientY - r.top) / zoom;
  }

  // ==== GLOBAL MOVE/UP ====
  function handleMove(e: MouseEvent) {
    if (dragLine !== null) {
      if (!worldEl || !svgEl) return;
      const wr = worldEl.getBoundingClientRect();
      const refs = data?.refs;
      if (!refs || !refs[dragLine]) return;
      const r = refs[dragLine];
      const fc = worldEl.querySelector(`.tcard[data-t="${r.fromTable}"]`);
      const tc = worldEl.querySelector(`.tcard[data-t="${r.toTable}"]`);
      if (!fc || !tc) return;
      const fcr = fc.getBoundingClientRect(), tcr = tc.getBoundingClientRect();
      const fcx = (fcr.left + fcr.right) * 0.5, tcx = (tcr.left + tcr.right) * 0.5;
      let sx: number, ex: number;
      if (fcx < tcx) { sx = (fcr.right - wr.left) / zoom; ex = (tcr.left - wr.left) / zoom; }
      else { sx = (fcr.left - wr.left) / zoom; ex = (tcr.right - wr.left) / zoom; }
      const mx0 = (sx + ex) * 0.5;
      lineAdj[dragLine] = (e.clientX - wr.left) / zoom - mx0;
      schedDraw();
      return;
    }
    if (isPan) {
      panX = ppx + (e.clientX - psx);
      panY = ppy + (e.clientY - psy);
      applyTf();
      schedDraw();
      return;
    }
    if (dragTarget) {
      if (!worldEl) return;
      // Clear line adj for refs connected to this table
      for (const k of Object.keys(lineAdj)) {
        const idx = parseInt(k);
        const rr = data?.refs[idx];
        if (rr && (rr.fromTable === dragTarget || rr.toTable === dragTarget)) {
          delete lineAdj[idx];
        }
      }
      const wr = worldEl.getBoundingClientRect();
      const nx = (e.clientX - wr.left) / zoom - dox;
      const ny = (e.clientY - wr.top) / zoom - doy;
      const card = worldEl.querySelector(`.tcard[data-t="${dragTarget}"]`) as HTMLElement;
      if (card) { card.style.left = nx + 'px'; card.style.top = ny + 'px'; }
      if (data.positions[dragTarget]) {
        data.positions[dragTarget].x = nx;
        data.positions[dragTarget].y = ny;
      }
      schedDraw();
      return;
    }
    if (tipVis) { tipX = e.clientX + 12; tipY = e.clientY + 12; }
  }

  function handleUp() {
    isPan = false;
    dragTarget = null;
    dragLine = null;
    if (canvasEl) canvasEl.style.cursor = '';
  }

  // ==== WHEEL ZOOM ====
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (!canvasEl) return;
    const r = canvasEl.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top, oz = zoom;
    zoom = Math.max(0.12, Math.min(4, zoom * (e.deltaY > 0 ? 0.92 : 1.08)));
    panX = mx - (mx - panX) * (zoom / oz);
    panY = my - (my - panY) * (zoom / oz);
    zoomPct = Math.round(zoom * 100);
    applyTf();
    schedDraw();
  }

  function doZoomIn() {
    if (!canvasEl) return;
    const r = canvasEl.getBoundingClientRect();
    const cx = r.width * 0.5, cy = r.height * 0.5, oz = zoom;
    zoom = Math.min(4, zoom * 1.2);
    panX = cx - (cx - panX) * (zoom / oz);
    panY = cy - (cy - panY) * (zoom / oz);
    zoomPct = Math.round(zoom * 100);
    applyTf(); schedDraw();
  }

  function doZoomOut() {
    if (!canvasEl) return;
    const r = canvasEl.getBoundingClientRect();
    const cx = r.width * 0.5, cy = r.height * 0.5, oz = zoom;
    zoom = Math.max(0.12, zoom / 1.2);
    panX = cx - (cx - panX) * (zoom / oz);
    panY = cy - (cy - panY) * (zoom / oz);
    zoomPct = Math.round(zoom * 100);
    applyTf(); schedDraw();
  }

  async function fitAll() {
    await tick();
    if (!worldEl || !canvasEl) return;
    const cards = worldEl.querySelectorAll<HTMLElement>('.tcard');
    if (!cards.length) return;
    let mnx = 1e9, mny = 1e9, mxx = -1e9, mxy = -1e9;
    cards.forEach(c => {
      const x = parseFloat(c.style.left) || 0, y = parseFloat(c.style.top) || 0;
      mnx = Math.min(mnx, x); mny = Math.min(mny, y);
      mxx = Math.max(mxx, x + c.offsetWidth); mxy = Math.max(mxy, y + c.offsetHeight);
    });
    const cw = canvasEl.offsetWidth, ch = canvasEl.offsetHeight, pad = 60;
    const dw = mxx - mnx + pad * 2, dh = mxy - mny + pad * 2;
    zoom = Math.min(cw / dw, ch / dh, 1.3);
    panX = (cw - dw * zoom) / 2 - (mnx - pad) * zoom;
    panY = (ch - dh * zoom) / 2 - (mny - pad) * zoom;
    zoomPct = Math.round(zoom * 100);
    applyTf(); schedDraw();
  }

  // ==== EXPORT ====
  async function doExportPNG() {
    if (!worldEl) return;
    const sz = zoom, sp = panX, spy = panY;
    zoom = 1; panX = 0; panY = 0; applyTf();
    await tick(); drawLines();
    try {
      const url = await htmlToImage.toPng(worldEl, { backgroundColor: theme === 'light' ? '#f4f4f8' : '#08080d', pixelRatio: 2 });
      dl(url, 'diagram.png');
    } catch (e) { console.error('PNG failed', e); }
    zoom = sz; panX = sp; panY = spy; applyTf();
    await tick(); drawLines();
  }

  async function doExportSVG() {
    if (!worldEl) return;
    const sz = zoom, sp = panX, spy = panY;
    zoom = 1; panX = 0; panY = 0; applyTf();
    await tick(); drawLines();
    try {
      const url = await htmlToImage.toSvg(worldEl, { backgroundColor: theme === 'light' ? '#f4f4f8' : '#08080d' });
      dl(url, 'diagram.svg');
    } catch (e) { console.error('SVG failed', e); }
    zoom = sz; panX = sp; panY = spy; applyTf();
    await tick(); drawLines();
  }

  function dl(url: string, name: string) { const a = document.createElement('a'); a.download = name; a.href = url; a.click(); }

  // ==== TOOLTIP ====
  function showTip(table: Table, field: TableField, e: MouseEvent) {
    hovTable = table.name; hovField = field.name;
    let h = `<div class="tf">${esc(field.name)}</div><div class="tt">${esc(field.type)}</div>`;
    const b: string[] = [];
    if (field.isPK) b.push('<span class="c-pk">PK</span>');
    if (field.isFK) b.push('<span class="c-fk">FK</span>');
    if (field.notNull) b.push('<span class="c-nn">NN</span>');
    if (field.unique) b.push('<span class="c-uq">UQ</span>');
    if (b.length) h += `<div class="tc">${b.join('')}</div>`;
    if (field.defaultVal) h += `<div class="td">default: ${esc(field.defaultVal)}</div>`;
    if (field.note) h += `<div class="tn">${esc(field.note)}</div>`;
    tipHtml = h; tipVis = true; tipX = e.clientX + 12; tipY = e.clientY + 12;

    worldEl?.querySelectorAll('.tcard.hi').forEach(c => c.classList.remove('hi'));
    worldEl?.querySelector(`.tcard[data-t="${hovTable}"]`)?.classList.add('hi');
    data.refs.filter(r => (r.fromTable === hovTable && r.fromField === hovField) || (r.toTable === hovTable && r.toField === hovField))
      .forEach(r => { const t = r.fromTable === hovTable ? r.toTable : r.fromTable; worldEl?.querySelector(`.tcard[data-t="${t}"]`)?.classList.add('hi'); });
    schedDraw();
  }

  function hideTip() {
    tipVis = false; hovTable = null; hovField = null;
    worldEl?.querySelectorAll('.tcard.hi').forEach(c => c.classList.remove('hi'));
    schedDraw();
  }

  function esc(s: string): string { 
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); 
  }

  function getTableClass(n: string): string {
    if (!n) return '';

    if (n.startsWith('fact_')) return 'c-fact';

    if (data && Array.isArray(data.refs)) {
      const referencesNonFact = data.refs.some(r => 
        r.fromTable === n && !r.toTable?.startsWith('fact_') && r.fromTable !== r.toTable
      );
      const referencedByFact = data.refs.some(r => 
        r.toTable === n && r.fromTable?.startsWith('fact_')
      );

      if (n.startsWith('dim_') && referencesNonFact && !referencedByFact) {
        return 'c-snow';
      }
    }

    if (n.startsWith('dim_')) return 'c-dim';

    return '';
  }

  function getTag(c: string): string {
    if (!c) return '';
    const tagMap: Record<string, string> = {
      'c-fact': 'FACT',
      'c-snow': 'SNOW',
      'c-dim': 'DIM'
    };
    return tagMap[c] || '';
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="dw" data-theme={theme}>
  <div class="bg-dots"></div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="canvas" bind:this={canvasEl} onmousedown={canvasDown} onwheel={onWheel}>
    <div class="world" bind:this={worldEl}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <svg class="lsvg" bind:this={svgEl} style:width="{svgW}px" style:height="{svgH}px" onmousedown={svgDown}></svg>

      {#each visibleTables as table (table.name)}
        {@const tc = getTableClass(table.name)}
        <div class="tcard {tc}" data-t={table.name} style:left="{data.positions[table.name]?.x || 0}px" style:top="{data.positions[table.name]?.y || 0}px">
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="thead" onmousedown={(e) => startDrag(e, table.name)}>
            <span class="tag">{getTag(tc)}</span>
            <span class="tname">{table.name}</span>
            <span class="tcnt">{table.fields.length}</span>
          </div>
          {#if table.note}<div class="tnote">{table.note}</div>{/if}
          <div class="colhdr"><span></span><span>Column</span><span>Type</span><span>Key</span></div>
          {#each table.fields as field}
            {@const pf = field.isPK && field.isFK}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div class="frow" class:pk={field.isPK && !field.isFK} class:fk={field.isFK && !field.isPK} class:pf class:hn={!!field.note} data-f={field.name} onmouseenter={(e) => showTip(table, field, e)} onmouseleave={hideTip}>
              <div class="fd"></div>
              <span class="fn">{field.name}</span>
              <span class="ft">{field.type}</span>
              <span class="fk-label">{pf ? 'PK·FK' : field.isPK ? 'PK' : field.isFK ? 'FK' : ''}</span>
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </div>

  <div class="search-wrap" class:active={searchFocused || searchQuery}>
    <input
      bind:this={searchInput}
      bind:value={searchQuery}
      onfocus={() => searchFocused = true}
      onblur={() => searchFocused = false}
      type="text"
      placeholder="Search tables & fields…"
      class="sbar"
    />
    {#if searchQuery}
      <button class="sclear" onclick={() => { searchQuery = ''; searchInput?.focus(); }}>×</button>
    {/if}
  </div>

  <div class="tip" class:vis={tipVis} style:left="{tipX}px" style:top="{tipY}px">{@html tipHtml}</div>

  {#if showLegend}
  <div class="legend">
    <h4>Legend</h4>
    <div class="li"><div class="ls" style="background:var(--dim);"></div>Dimension</div>
    <div class="li"><div class="ls" style="background:var(--fact);"></div>Fact</div>
    <div class="li"><div class="ls" style="background:var(--snow);"></div>Snowflake</div>
    <div class="li"><div class="ls" style="background:var(--pk);border-radius:50%;"></div>PK</div>
    <div class="li"><div class="ls" style="background:var(--fk);border-radius:50%;"></div>FK</div>
    <div class="li"><div class="ls" style="background:var(--pkfk);border-radius:50%;"></div>PK+FK</div>
  </div>
  {/if}

  <div class="zbar">
    <button onclick={doZoomOut}>−</button>
    <span class="zlvl">{zoomPct}%</span>
    <button onclick={doZoomIn}>+</button>
  </div>
</div>

<style>
.dw{width:100%;height:100%;position:relative;overflow:hidden;background:var(--bg);color:var(--text)}
.bg-dots{position:absolute;inset:0;background-image:radial-gradient(circle,var(--bg-dot) 1px,transparent 1px);background-size:28px 28px;pointer-events:none;z-index:0}
.canvas{position:absolute;inset:0;overflow:hidden}
.world{position:absolute;transform-origin:0 0;will-change:transform}

.lsvg{position:absolute;top:0;left:0;pointer-events:none;z-index:1}
:global(.lsvg path.rel){fill:none;stroke-width:1.4;stroke-linecap:round;stroke-linejoin:round;stroke:var(--accent);opacity:0.35;pointer-events:none}
:global(.lsvg path.rel.hi){opacity:0.85;stroke-width:2.2}
:global(.rel-bg){fill:none;stroke:transparent;stroke-width:14;pointer-events:auto;cursor:ew-resize}
:global(.lsvg circle.rdot){fill:var(--accent);opacity:0.3}
:global(.lsvg circle.rdot.hi){opacity:0.9}
:global(.lsvg text.clbl){font-family:var(--mono);font-size:11px;font-weight:700;fill:var(--accent);opacity:0.45}
:global(.lsvg text.clbl.hi){opacity:1}

.tcard{position:absolute;background:var(--surface);border:1px solid var(--border);border-radius:10px;min-width:320px;max-width:420px;box-shadow:0 2px 20px rgba(0,0,0,0.45);z-index:2;user-select:none}
.tcard.c-dim{border-color:var(--dim-bdr)}.tcard.c-fact{border-color:var(--fact-bdr)}.tcard.c-snow{border-color:var(--snow-bdr)}
:global(.tcard.hi.c-dim){border-color:var(--dim);box-shadow:0 0 28px rgba(96,165,250,0.1)}
:global(.tcard.hi.c-fact){border-color:var(--fact);box-shadow:0 0 28px rgba(192,132,252,0.1)}
:global(.tcard.hi.c-snow){border-color:var(--snow);box-shadow:0 0 28px rgba(52,211,153,0.1)}

.thead{padding:10px 14px;border-bottom:1px solid var(--border);cursor:grab;display:flex;align-items:center;gap:8px;border-radius:10px 10px 0 0}
.thead:active{cursor:grabbing}
.tcard.c-dim .thead{background:var(--dim-bg)}.tcard.c-fact .thead{background:var(--fact-bg)}.tcard.c-snow .thead{background:var(--snow-bg)}
.thead .tag{font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;padding:2px 6px;border-radius:4px}
.tcard.c-dim .thead .tag{background:rgba(96,165,250,0.12);color:var(--dim)}
.tcard.c-fact .thead .tag{background:rgba(192,132,252,0.12);color:var(--fact)}
.tcard.c-snow .thead .tag{background:rgba(52,211,153,0.12);color:var(--snow)}
.thead .tname{font-family:var(--mono);font-size:12.5px;font-weight:600}
.thead .tcnt{margin-left:auto;font-size:10px;color:var(--text-faint)}

.tnote{padding:6px 14px;font-size:10.5px;color:var(--text-dim);border-bottom:1px solid var(--border);line-height:1.45;font-style:italic;max-height:44px;overflow:hidden}
.tnote:hover{max-height:200px;color:var(--text)}

.colhdr{display:grid;grid-template-columns:18px 1fr 90px 38px;padding:4px 14px;border-bottom:1px solid rgba(255,255,255,0.025);font-size:8.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.07em;color:var(--text-faint)}
.frow{display:grid;grid-template-columns:18px 1fr 90px 38px;padding:4px 14px;align-items:center;border-bottom:1px solid rgba(255,255,255,0.015)}
.frow:last-child{border-bottom:none;border-radius:0 0 10px 10px}
.frow:hover{background:rgba(255,255,255,0.02)}
.frow.hn:hover{background:rgba(129,140,248,0.04)}

.frow .fd{width:5px;height:5px;border-radius:50%;background:var(--border);justify-self:center}
.frow.pk .fd{background:var(--pk);box-shadow:0 0 5px rgba(251,191,36,0.25)}
.frow.fk .fd{background:var(--fk);box-shadow:0 0 5px rgba(52,211,153,0.25)}
.frow.pf .fd{background:var(--pkfk);box-shadow:0 0 5px rgba(251,146,60,0.25)}

.frow .fn{font-family:var(--mono);font-size:11.5px;font-weight:500;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.frow.pk .fn{color:#fde68a}.frow.fk .fn{color:#a7f3d0}.frow.pf .fn{color:#fed7aa}
.frow.hn .fn::after{content:'';display:inline-block;width:3.5px;height:3.5px;background:var(--accent);border-radius:50%;margin-left:5px;vertical-align:middle;opacity:0.5}

.frow .ft{font-family:var(--mono);font-size:10px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.frow .fk-label{justify-self:center;font-size:7.5px;font-weight:800;border-radius:3px;padding:1px 5px}
.frow.pk .fk-label{background:var(--pk-bg);color:var(--pk)}
.frow.fk .fk-label{background:var(--fk-bg);color:var(--fk)}
.frow.pf .fk-label{background:var(--pkfk-bg);color:var(--pkfk)}

.tip{position:fixed;background:var(--surface-up);border:1px solid var(--border-hi);border-radius:8px;padding:10px 14px;max-width:380px;z-index:1000;pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .12s,transform .12s;box-shadow:0 8px 36px rgba(0,0,0,0.6)}
.tip.vis{opacity:1;transform:translateY(0)}
:global(.tip .tf){font-family:var(--mono);font-weight:600;color:var(--accent);font-size:12px;margin-bottom:2px}
:global(.tip .tt){font-family:var(--mono);font-size:9.5px;color:var(--text-dim);margin-bottom:4px}
:global(.tip .tc){display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px}
:global(.tip .tc span){font-size:8px;font-weight:700;padding:1px 5px;border-radius:3px;border:1px solid var(--border)}
:global(.tip .tc .c-pk){color:var(--pk);border-color:var(--pk);background:var(--pk-bg)}
:global(.tip .tc .c-fk){color:var(--fk);border-color:var(--fk);background:var(--fk-bg)}
:global(.tip .tc .c-nn){color:#f472b6}
:global(.tip .tc .c-uq){color:#38bdf8}
:global(.tip .td){font-family:var(--mono);font-size:9px;color:var(--text-dim);margin-top:4px}
:global(.tip .tn){font-size:11px;color:var(--text);line-height:1.5;border-top:1px solid var(--border);padding-top:6px;margin-top:4px}

.legend{position:absolute;bottom:16px;left:16px;background:var(--panel-bg);backdrop-filter:blur(14px);border:1px solid var(--border);border-radius:10px;padding:12px 16px;z-index:90;font-size:10px}
.legend h4{font-size:8px;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-faint);margin-bottom:8px}
.li{display:flex;align-items:center;gap:7px;margin-bottom:4px;color:var(--text-dim)}
.ls{width:9px;height:9px;border-radius:2px}

.zbar{position:absolute;bottom:16px;left:50%;transform:translateX(-50%);background:var(--panel-bg);backdrop-filter:blur(14px);border:1px solid var(--border);border-radius:8px;padding:4px 12px;z-index:90;font-size:11px;display:flex;align-items:center;gap:8px;color:var(--text-dim)}
.zbar button{font-family:var(--mono);background:none;border:1px solid var(--border);color:var(--text-dim);width:22px;height:22px;border-radius:4px;cursor:pointer;font-size:14px;display:grid;place-items:center}
.zbar button:hover{background:rgba(255,255,255,0.06);color:var(--text)}
.zlvl{min-width:40px;text-align:center}

.search-wrap{position:absolute;top:16px;right:16px;z-index:90;display:flex;align-items:center;gap:4px;transition:opacity .15s}
.search-wrap.active .sbar{opacity:1;width:180px}
.search-wrap:not(.active) .sbar{opacity:0.3;width:100px}
.search-wrap .sbar{background:var(--panel-bg);backdrop-filter:blur(14px);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-family:var(--mono);font-size:11px;color:var(--text);outline:none;transition:all .15s}
.search-wrap .sbar:focus{opacity:1;width:220px;border-color:var(--accent);opacity:1}
.search-wrap .sbar::placeholder{color:var(--text-faint);font-size:10.5px}
.sclear{background:none;border:none;color:var(--text-dim);cursor:pointer;font-size:15px;padding:0 4px;line-height:1}
.sclear:hover{color:var(--text)}

:global(.lhandle){fill:var(--accent);opacity:0.3;cursor:ew-resize;stroke:var(--accent);stroke-width:1.5;pointer-events:auto}
:global(.lhandle:hover){opacity:0.8}
:global(.lhandle.dl){opacity:0.9;stroke-width:2.5;r:6}
</style>
