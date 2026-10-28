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
  let view = { x: 0, y: 0, k: 1 }, alpha = 1, running = false, fitted = false, labelMin = 99;

  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function colours() {
    const names = Object.keys(themes);
    const dark = document.documentElement.dataset.theme === "dark";
    themeColour = {};
    names.forEach((t, i) => {
      const hue = Math.round((i * 360) / names.length + 140) % 360;
      themeColour[t] = `hsl(${hue} ${dark ? 35 : 38}% ${dark ? 62 : 48}%)`;
    });
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
    // label only the ten most used hashtags until you hover or zoom in
    labelMin = (nodes.map((n) => n.uses).sort((a, b) => b - a)[9]) || 1;
    drawLegend();
    alpha = 1; fitted = false;
    start();
  }

  // ---- layout: plain force simulation, cools down and stops ----
  function tick() {
    const rep = 3200, spring = 0.06, grav = 0.012;
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.01;
        if (d2 > 250000) continue;
        const f = (rep / d2) * alpha, d = Math.sqrt(d2);
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
      if (n === drag) continue;
      n.vx -= n.x * grav * alpha; n.vy -= n.y * grav * alpha;
      n.vx *= 0.6; n.vy *= 0.6;
      n.x += n.vx; n.y += n.vy;
    }
    alpha *= 0.985;
  }

  function start() {
    if (running) return;
    running = true;
    (function loop() {
      tick(); draw();
      if (!fitted && alpha < 0.25) fit();
      if (alpha > 0.02 || drag) requestAnimationFrame(loop); else { running = false; draw(); }
    })();
  }

  // zoom so the whole graph fits the window
  function fit() {
    fitted = true;
    if (!nodes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
    const k = Math.min((W - 60) / (x1 - x0 || 1), (H - 60) / (y1 - y0 || 1), 1.6);
    view.k = Math.max(0.3, k);
    view.x = -((x0 + x1) / 2) * view.k;
    view.y = -((y0 + y1) / 2) * view.k;
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
      ctx.globalAlpha = lit(n) ? 1 : 0.15;
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
      b.onclick = () => { pickedTheme = pickedTheme === t ? null : t; picked = null; drawLegend(); showNotes(); draw(); };
      legend.appendChild(b);
    }
  }

  function showNotes() {
    if (!picked) { list.innerHTML = ""; list.hidden = true; return; }
    const notes = byTag[picked.id] || [];
    list.hidden = false;
    list.innerHTML = `<p class="graph-notes-head">#${picked.id} · ${notes.length}</p><ol>` +
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
    view.k = Math.min(4, Math.max(0.3, view.k * (e.deltaY < 0 ? 1.12 : 0.89)));
    draw();
  }, { passive: false });

  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = canvas.clientWidth; H = canvas.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    draw();
  }
  window.addEventListener("resize", resize);

  // threshold buttons
  let data = null;
  box.querySelectorAll("[data-min]").forEach((b) => b.addEventListener("click", () => {
    minUses = +b.dataset.min;
    box.querySelectorAll("[data-min]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    picked = null; showNotes();
    build(data);
  }));
  new MutationObserver(() => { colours(); drawLegend(); draw(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  fetch(box.dataset.graph).then((r) => r.json()).then((d) => { data = d; resize(); build(d); });
})();
