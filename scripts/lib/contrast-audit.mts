/**
 * The WCAG 1.4.3 contrast walk of `scripts/arena-contrast.mts` (issue #343), shared with the phone
 * run (`scripts/arena-phone-run.mts`). See that script's header for what the walk does and does
 * not see (gradients composited stop by stop; text over images judged against black and white).
 */
export type ContrastRow = { text: string; selector: string; ratio: number; need: number; size: number; bold: boolean; outlined: boolean; fg: number[]; bg: number[]; image: boolean; x: number; y: number };

/** Runs in the page. Returns one row per visible text node: its worst-case ratio. */
export const CONTRAST_AUDIT = String.raw`(() => {
  const cv = document.createElement("canvas");
  cv.width = cv.height = 1;
  const cx = cv.getContext("2d", { willReadFrequently: true });
  // Any CSS colour syntax (rgb, oklch, color-mix, named) -> [r,g,b,a] via the browser itself.
  const parse = (str) => {
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = "#000";
    cx.fillStyle = str;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    // fillStyle falls back silently to the previous value on a syntax it cannot read
    return [d[0], d[1], d[2], str === "transparent" ? 0 : d[3] / 255];
  };
  const over = (top, under) => {
    const a = top[3];
    return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1];
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const COLOUR = /(rgba?\([^)]*\)|hsla?\([^)]*\)|color\([^)]*\)|oklab\([^)]*\)|oklch\([^)]*\)|lab\([^)]*\)|lch\([^)]*\)|#[0-9a-fA-F]{3,8}\b|transparent)/g;
  const stopsOf = (img) => {
    const out = [];
    for (const layer of img.split(/,\s*(?=(?:linear|radial|conic|repeating)-gradient|url\()/)) {
      if (/gradient\(/.test(layer)) out.push({ kind: "gradient", stops: (layer.match(COLOUR) || []).map(parse) });
      else if (/url\(/.test(layer)) out.push({ kind: "image" });
    }
    return out;
  };
  const dedupe = (cands) => {
    const seen = new Map();
    for (const c of cands) seen.set(c.map((v) => Math.round(v)).join(","), c);
    let list = [...seen.values()];
    if (list.length > 24) { list.sort((a, b) => lum(a) - lum(b)); list = list.filter((_, i) => i % Math.ceil(list.length / 24) === 0 || i === list.length - 1); }
    return list;
  };
  const cumOpacity = (el) => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity); return o; };
  const sel = (el) => {
    const parts = [];
    for (let e = el; e && e.nodeType === 1 && parts.length < 4; e = e.parentElement) {
      let p = e.tagName.toLowerCase();
      const cls = [...e.classList].filter((c) => /^arena/.test(c)).slice(0, 2);
      if (cls.length) p += "." + cls.join(".");
      else if (e.dataset && e.dataset.arenaCard) p += "[card]";
      parts.unshift(p);
    }
    return parts.join(" > ");
  };

  // Backdrop candidates under an element: walk up to the first opaque ground, then composite back down.
  const backdrops = (el) => {
    const chain = [];
    let ground = null, image = false;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const layers = stopsOf(cs.backgroundImage);
      chain.push({ e, cs, layers, bg: parse(cs.backgroundColor), o: parseFloat(cs.opacity) });
      const opaqueSolid = parse(cs.backgroundColor)[3] >= 0.999 && parseFloat(cs.opacity) >= 0.999 && !layers.some((l) => l.kind === "gradient" && l.stops.some((s) => s[3] < 0.999));
      if (layers.some((l) => l.kind === "image")) image = true;
      if (opaqueSolid) { ground = e; break; }
    }
    let cands = ground ? [[0, 0, 0, 1]] : [[255, 255, 255, 1]];
    if (image) cands = [[0, 0, 0, 1], [255, 255, 255, 1]];
    for (let i = chain.length - 1; i >= 0; i--) {
      const { bg, layers, o } = chain[i];
      const fade = (c) => [c[0], c[1], c[2], c[3] * o];
      if (bg[3] > 0) cands = cands.map((c) => over(fade(bg), c));
      // A gradient paints above the colour; any one of its stops may sit behind the text.
      const grads = layers.filter((l) => l.kind === "gradient" && l.stops.length);
      for (const g of grads) cands = dedupe(cands.flatMap((c) => g.stops.map((s) => over(fade(s), c))));
    }
    return { cands: dedupe(cands), image };
  };

  const rows = [];
  const walker = document.createTreeWalker(document.querySelector(".arena"), NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el || el.closest("script,style,noscript,nextjs-portal")) continue;
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || cumOpacity(el) < 0.05) continue;
    if ((cs.webkitBackgroundClip || cs.backgroundClip) === "text") continue;
    const fill = parse(cs.webkitTextFillColor && cs.webkitTextFillColor !== "rgba(0, 0, 0, 0)" ? cs.webkitTextFillColor : cs.color);
    fill[3] *= cumOpacity(el);
    const { cands, image } = backdrops(el);
    // An ink outline (-webkit-text-stroke, docs/arena-skin-spec.md decision 5) carries the
    // legibility of the impact numerals; judge the outline colour against the ground instead.
    const strokeW = parseFloat(cs.webkitTextStrokeWidth) || 0;
    const outlined = strokeW >= 1;
    if (outlined) { const st = parse(cs.webkitTextStrokeColor); st[3] *= cumOpacity(el); fill[0] = st[0]; fill[1] = st[1]; fill[2] = st[2]; fill[3] = st[3]; }
    let worst = Infinity, against = null;
    for (const c of cands) { const fg = over(fill, c); const k = ratio(fg, c); if (k < worst) { worst = k; against = { fg: fg.map(Math.round), bg: c.map(Math.round) }; } }
    const px = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = px >= 24 || (px >= 18.66 && bold);
    rows.push({ text: text.slice(0, 40), selector: sel(el), ratio: Math.round(worst * 100) / 100, need: large ? 3 : 4.5, size: px, bold, outlined, fg: against.fg, bg: against.bg, image, x: Math.round(r.left), y: Math.round(r.top) });
  }
  return rows;
})()`;
