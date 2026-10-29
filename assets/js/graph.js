// Small hashtag graph for the notes page, in the spirit of Obsidian Publish.
// Nodes: hashtags (cleaned via data/tags.yaml). Lines: hashtags used in the same note.
// Loaded only when someone opens the graph. No libraries.
(function () {
  const box = document.querySelector("[data-graph]");
  if (!box) return;
  const canvas = box.querySelector("canvas");
  const list = box.querySelector(".graph-notes");
  const legend = box.querySelector(".graph-legend");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0, dpr = 1;
  let nodes = [], links = [], byTag = {}, themes = {}, themeColour = {};
  let minUses = 3, hover = null, picked = null, pickedTheme = null;
  let view = { x: 0, y: 0, k: 1 }, alpha = 1, running = false, shown = false, animId = 0, labelMin = 99;

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function colours() {
    const names = Object.keys(themes);
    const dark = document.documentElement.dataset.theme === "dark";
    themeColour = {};
    // hand-picked, clearly different colours; repeats only after 14 themes
    const light = ["#2f7a52", "#8a4fb3", "#2f86b8", "#c0473f", "#d18a1f", "#28407f", "#9a6337", "#1f9a8c", "#c2549b", "#7a8a1f", "#5f73d6", "#7d2436", "#4caf50", "#e2622b"];
    const darkP = ["#6cc596", "#b98ae0", "#6fb6e3", "#ea8079", "#f0b358", "#8ea4e8", "#cf9a6c", "#5fcfc0", "#e88ac6", "#b8c35a", "#9aa8f0", "#d46a7d", "#8ed88f", "#ff9a66"];
    names.forEach((t, i) => { themeColour[t] = (dark ? darkP : light)[i % light.length]; });
  }

  function build(data) {
    themes = {};
    for (const t of Object.values(data.themes)) themes[t] = true;
    colours();
    const uses = {}, pairs = {};
    byTag = {};
    for (const n of data.notes) {
      for (const g of n.g) { uses[g] = (uses[g] || 0) + 1; (byTag[g] = byTag[g] || []).push(n); }
    }
    const keep = new Set(Object.keys(uses).filter((g) => uses[g] >= minUses));
    for (const n of data.notes) {
      const g = n.g.filter((x) => keep.has(x)).sort();
      for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
        const k = g[i] + "\u0000" + g[j];
        pairs[k] = (pairs[k] || 0) + 1;
      }
    }
    const old = Object.fromEntries(nodes.map((n) => [n.id, n]));
    nodes = [...keep].map((id, i) => {
      const a = (i / keep.size) * Math.PI * 2;
      const o = old[id];
      return { id, uses: uses[id], theme: data.themes[id] || null,
        x: o ? o.x : Math.cos(a) * 120 + Math.random() * 10, y: o ? o.y : Math.sin(a) * 120 + Math.random() * 10,
        vx: 0, vy: 0, r: 2.5 + Math.sqrt(uses[id]) * 1.6 };
    });
    const idx = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
    links = Object.entries(pairs).map(([k, w]) => {
      const [a, b] = k.split("\u0000");
      const s = nodes[idx[a]], t = nodes[idx[b]];
      // association strength: shared notes relative to how often both tags occur,
      // so hubs like #vietnam don't pull everything into one knot
      return { s, t, w, a: w / Math.sqrt(s.uses * t.uses) };
    });
    for (const n of nodes) n.nb = new Set();
    for (const l of links) { l.s.nb.add(l.t); l.t.nb.add(l.s); }
    // hashtags without any connection don't take part in the layout, they sit on a ring
    for (const n of nodes) n.fixed = n.nb.size === 0;
    // label only the ten most used hashtags until you hover or zoom in
    labelMin = (nodes.map((n) => n.uses).sort((a, b) => b - a)[9]) || 1;
    drawLegend();
    // compute the layout before showing it, so the graph appears calm and finished
    const from = new Map(nodes.filter((n) => old[n.id]).map((n) => [n, { x: n.x, y: n.y }]));
    alpha = 1;
    for (let k = 0; k < 400 && alpha > 0.02; k++) tick();
    ring();
    const target = fitView();
    if (!shown) { view = target; shown = true; draw(); return; }
    // otherwise glide from the old picture to the new one
    const to = new Map(nodes.map((n) => [n, { x: n.x, y: n.y }]));
    const v0 = { ...view }, t0 = performance.now(), dur = 450;
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const anim = ++animId;
    (function step(now) {
      if (anim !== animId) return;
      const t = ease(Math.min(1, (now - t0) / dur));
      for (const n of nodes) {
        const a = from.get(n), b = to.get(n);
        n.fade = a ? 1 : t;
        n.x = a ? a.x + (b.x - a.x) * t : b.x;
        n.y = a ? a.y + (b.y - a.y) * t : b.y;
      }
      view = { x: v0.x + (target.x - v0.x) * t, y: v0.y + (target.y - v0.y) * t, k: v0.k + (target.k - v0.k) * t };
      draw();
      if (t < 1) requestAnimationFrame(step);
    })(t0);
  }

  // loners on one or more rings around the connected part
  function ring() {
    const core = nodes.filter((n) => !n.fixed), lone = nodes.filter((n) => n.fixed).sort((a, b) => b.uses - a.uses);
    if (!lone.length) return;
    let cx = 0, cy = 0;
    for (const n of core) { cx += n.x; cy += n.y; }
    if (core.length) { cx /= core.length; cy /= core.length; }
    const d = core.map((n) => Math.hypot(n.x - cx, n.y - cy)).sort((a, b) => a - b);
    let r = (d[Math.floor(d.length * 0.95)] || 60) + 50, k = 0;
    while (k < lone.length) {
      const fit = Math.max(8, Math.floor((2 * Math.PI * r) / 16));
      const part = lone.slice(k, k + fit);
      part.forEach((n, j) => {
        const a = (j / part.length) * Math.PI * 2 + r * 0.01;
        n.x = cx + Math.cos(a) * r; n.y = cy + Math.sin(a) * r; n.vx = n.vy = 0;
      });
      k += fit; r += 18;
    }
  }

  // ---- layout: plain force simulation, cools down and stops ----
  function tick() {
    const rep = 3200, spring = 0.06, grav = 0.012;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      if (a.fixed) continue;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        if (b.fixed) continue;
        let dx = a.x - b.x, dy = a.y - b.y, d2 = Math.max(dx * dx + dy * dy, 36);
        if (!dx && !dy) dx = Math.random() - 0.5;
        if (d2 > 250000) continue;
        const d = Math.sqrt(dx * dx + dy * dy) || 1, f = (rep / d2) * alpha;
        dx /= d; dy /= d;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
    }
    for (const l of links) {
      const dx = l.t.x - l.s.x, dy = l.t.y - l.s.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - (40 + 90 * (1 - Math.min(1, l.a * 2)))) * spring * l.a * alpha;
      l.s.vx += (dx / d) * f; l.s.vy += (dy / d) * f; l.t.vx -= (dx / d) * f; l.t.vy -= (dy / d) * f;
    }
    for (const n of nodes) {
      if (n === drag || n.fixed) continue;
      n.vx -= n.x * grav * alpha; n.vy -= n.y * grav * alpha;
      n.vx *= 0.6; n.vy *= 0.6;
      const v = Math.hypot(n.vx, n.vy);
      if (v > 12) { n.vx *= 12 / v; n.vy *= 12 / v; } // no node gets flung away
      n.x += n.vx; n.y += n.vy;
    }
    alpha *= 0.985;
  }

  function start() {
    if (running) return;
    running = true;
    (function loop() {
      tick(); draw();
      if (alpha > 0.02 || drag) requestAnimationFrame(loop); else { running = false; draw(); }
    })();
  }

  // view that fits the graph into the window; a few stray points don't count
  function fitView() {
    if (!nodes.length) return { x: 0, y: 0, k: 1 };
    const xs = nodes.map((n) => n.x).sort((a, b) => a - b), ys = nodes.map((n) => n.y).sort((a, b) => a - b);
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.max(0, Math.round((arr.length - 1) * p)))];
    const cut = nodes.length > 60 ? 0.01 : 0;
    const x0 = q(xs, cut), x1 = q(xs, 1 - cut), y0 = q(ys, cut), y1 = q(ys, 1 - cut);
    const k = Math.max(0.25, Math.min((W - 70) / (x1 - x0 || 1), (H - 70) / (y1 - y0 || 1), 1.6));
    return { x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k, k };
  }

  // ---- drawing ----
  function lit(n) {
    if (picked) return n === picked || picked.nb.has(n);
    if (hover) return n === hover || hover.nb.has(n);
    if (pickedTheme) return n.theme === pickedTheme;
    return true;
  }

  function draw() {
    const ink = css("--primary") || "#222", line = css("--secondary") || "#999";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(W / 2 + view.x, H / 2 + view.y);
    ctx.scale(view.k, view.k);
    const focus = picked || hover || pickedTheme;
    for (const l of links) {
      const on = !focus || (lit(l.s) && lit(l.t) && (!(picked || hover) || l.s === (picked || hover) || l.t === (picked || hover)));
      ctx.globalAlpha = on ? Math.min(0.6, 0.1 + l.a * 0.9) : 0.04;
      ctx.strokeStyle = line;
      ctx.lineWidth = (on && focus ? 1.2 : 0.7) / view.k;
      ctx.beginPath(); ctx.moveTo(l.s.x, l.s.y); ctx.lineTo(l.t.x, l.t.y); ctx.stroke();
    }
    ctx.font = `${11 / view.k}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = "center";
    for (const n of nodes) {
      ctx.globalAlpha = (lit(n) ? 1 : 0.15) * (n.fade ?? 1);
      ctx.fillStyle = n.theme ? themeColour[n.theme] : line;
      ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
    }
    const placed = [];
    const order = [...nodes].sort((a, b) => (b === (picked || hover)) - (a === (picked || hover)) || b.uses - a.uses);
    for (const n of order) {
      const on = lit(n);
      const want = (focus && on) || (!focus && (n.uses >= labelMin || view.k > 1.8));
      if (!want) continue;
      const w = ctx.measureText(n.id).width, h = 11 / view.k;
      const box = { x0: n.x - w / 2, x1: n.x + w / 2, y1: n.y - n.r - 3 / view.k, y0: n.y - n.r - 3 / view.k - h };
      if (placed.some((b) => box.x0 < b.x1 && box.x1 > b.x0 && box.y0 < b.y1 && box.y1 > b.y0)) continue;
      placed.push(box);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = ink;
      ctx.fillText(n.id, n.x, box.y1);
    }
    ctx.globalAlpha = 1;
  }

  function drawLegend() {
    legend.innerHTML = "";
    for (const t of Object.keys(themes)) {
      if (!nodes.some((n) => n.theme === t)) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<i style="background:${themeColour[t]}"></i>${t}`;
      b.setAttribute("aria-pressed", pickedTheme === t);
      b.onclick = () => { pickedTheme = pickedTheme === t ? null : t; picked = null; hover = null; drawLegend(); showNotes(); draw(); };
      legend.appendChild(b);
    }
  }

  function showNotes() {
    let head = "", notes = [];
    if (picked) {
      head = `#${picked.id}`;
      notes = byTag[picked.id] || [];
    } else if (pickedTheme) {
      // every note with at least one hashtag of this theme that is shown in the graph
      head = pickedTheme;
      const seen = new Set();
      for (const n of nodes) if (n.theme === pickedTheme) for (const x of byTag[n.id] || []) seen.add(x);
      notes = data.notes.filter((x) => seen.has(x));
    }
    if (!head) { list.innerHTML = ""; list.hidden = true; return; }
    list.hidden = false;
    list.innerHTML = `<p class="graph-notes-head">${escapeHtml(head)} · ${notes.length}</p><ol>` +
      notes.slice(0, 30).map((n) => `<li><a href="${n.u}"><span>${n.d}</span>${escapeHtml(n.t)}</a></li>`).join("") +
      `</ol>`;
  }
  const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---- interaction: hover, click, drag nodes, pan, zoom ----
  let drag = null, panning = null, moved = false;
  function toWorld(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left - W / 2 - view.x) / view.k, y: (e.clientY - r.top - H / 2 - view.y) / view.k };
  }
  function nodeAt(p) {
    let best = null, bd = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < Math.max(n.r + 4, 8 / view.k) && d < bd) { best = n; bd = d; }
    }
    return best;
  }
  canvas.addEventListener("pointermove", (e) => {
    const p = toWorld(e);
    if (drag) { drag.x = p.x; drag.y = p.y; moved = true; alpha = Math.max(alpha, 0.3); start(); return; }
    if (panning) { view.x += e.movementX; view.y += e.movementY; moved = true; draw(); return; }
    const n = nodeAt(p);
    if (n !== hover) { hover = n; canvas.style.cursor = n ? "pointer" : "grab"; draw(); }
  });
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    moved = false;
    const n = nodeAt(toWorld(e));
    if (n) drag = n; else panning = true;
    animId++;
  });
  canvas.addEventListener("pointerup", () => {
    if (!moved) {
      const n = drag;
      picked = n && picked !== n ? n : null;
      pickedTheme = null;
      drawLegend(); showNotes(); draw();
    }
    drag = null; panning = null;
  });
  canvas.addEventListener("pointerleave", () => { hover = null; draw(); });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    view.k = Math.min(4, Math.max(0.25, view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    draw();
  }, { passive: false });

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    draw();
  }
  new ResizeObserver(() => { if (canvas.clientWidth && canvas.clientWidth !== W) resize(); }).observe(canvas);

  // threshold buttons
  let data = null;
  box.querySelectorAll("[data-min]").forEach((b) => b.addEventListener("click", () => {
    minUses = +b.dataset.min;
    box.querySelectorAll("[data-min]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    picked = null; hover = null;
    build(data); showNotes();
  }));
  new MutationObserver(() => { colours(); drawLegend(); draw(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  fetch(box.dataset.graph).then((r) => r.json()).then((d) => { data = d; resize(); build(d); });
})();
