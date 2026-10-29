// Photo lightbox for the photo grids: the original, in colour, loaded on click.
(function () {
  const links = [...document.querySelectorAll(".photo-grid a.lb")];
  if (!links.length) return;

  const dlg = document.createElement("dialog");
  dlg.className = "lightbox";
  dlg.innerHTML =
    '<figure><img alt=""><figcaption>' +
    '<span class="lb-alt"></span>' +
    '<span class="lb-meta"><a class="lb-post"></a> · <a class="lb-orig" target="_blank" rel="noopener">original</a> · <span class="lb-count"></span></span>' +
    "</figcaption></figure>" +
    '<button type="button" class="lb-prev" aria-label="Previous photo">←</button>' +
    '<button type="button" class="lb-next" aria-label="Next photo">→</button>' +
    '<button type="button" class="lb-close" aria-label="Close">close</button>';
  document.body.appendChild(dlg);
  const img = dlg.querySelector("img");
  const $ = (s) => dlg.querySelector(s);
  let i = 0, token = 0;

  const BLANK = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  function size(a) {
    const w = +a.dataset.w, h = +a.dataset.h;
    if (!w) { img.style.width = img.style.height = ""; return; }
    const narrow = innerWidth <= 600;
    const k = Math.min(1, (innerWidth - (narrow ? 20 : 112) - 14) / w, (innerHeight - 130 - 14) / h);
    img.style.width = Math.round(w * k) + 14 + "px";
    img.style.height = Math.round(h * k) + 14 + "px";
  }
  addEventListener("resize", () => { if (dlg.open) size(links[i]); });

  function preload(n) { const a = links[(n + links.length) % links.length]; new Image().src = a.href; }

  function show(n) {
    i = (n + links.length) % links.length;
    const a = links[i], thumb = a.querySelector("img");
    const t = ++token;
    // reserve the right shape at once, fade the photo in when it is there
    img.classList.add("lb-loading");
    img.src = BLANK;
    size(a);
    img.alt = thumb.alt;
    const full = new Image();
    full.onload = () => { if (t === token) { img.src = full.src; img.classList.remove("lb-loading"); } };
    full.src = a.href;
    if (full.complete) { img.src = full.src; img.classList.remove("lb-loading"); }
    $(".lb-alt").textContent = thumb.alt;
    $(".lb-post").textContent = a.dataset.date;
    $(".lb-post").href = a.dataset.post;
    $(".lb-orig").href = a.href;
    $(".lb-count").textContent = `${i + 1}/${links.length}`;
    preload(i + 1); preload(i - 1);
  }

  links.forEach((a, n) => a.addEventListener("click", (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey) return; // let people open a new tab
    e.preventDefault();
    show(n);
    dlg.showModal();
  }));
  $(".lb-prev").onclick = () => show(i - 1);
  $(".lb-next").onclick = () => show(i + 1);
  $(".lb-close").onclick = () => dlg.close();
  dlg.addEventListener("click", (e) => { if (e.target === dlg || e.target.tagName === "FIGURE") dlg.close(); });
  dlg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") show(i - 1);
    if (e.key === "ArrowRight") show(i + 1);
  });
  dlg.addEventListener("close", () => { token++; img.removeAttribute("src"); });

  // swipe on phones
  let x0 = null;
  dlg.addEventListener("touchstart", (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  dlg.addEventListener("touchend", (e) => {
    if (x0 === null) return;
    const dx = e.changedTouches[0].clientX - x0;
    if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1));
    x0 = null;
  });
})();
