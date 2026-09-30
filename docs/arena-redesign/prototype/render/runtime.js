// Minimal static renderer for the prototype's .dc.html templates: holes, sc-if, sc-for.
// Events are dropped — this is a camera, not a player.
class DCLogic {
  constructor(props) { this.props = props || {}; }
  setState(u) { const r = typeof u === 'function' ? u(this.state) : u; this.state = Object.assign({}, this.state, r); }
  forceUpdate() { }
}
window.DCLogic = DCLogic;
const WHOLE = /^\s*\{\{([^}]+)\}\}\s*$/;
function lookup(path, scope) {
  path = path.trim();
  if (path === 'true') return true; if (path === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(path)) return Number(path);
  let v = scope; for (const k of path.split('.')) { if (v == null) return undefined; v = v[k]; } return v;
}
function interp(str, scope) { return str.replace(/\{\{([^}]+)\}\}/g, (m, p) => { const v = lookup(p, scope); return v == null ? '' : String(v); }); }
function proc(node, scope, out) {
  if (node.nodeType === 3) { out.appendChild(document.createTextNode(interp(node.nodeValue, scope))); return; }
  if (node.nodeType !== 1) return;
  const tag = node.tagName.toLowerCase();
  if (tag === 'sc-if') { const m = WHOLE.exec(node.getAttribute('value') || ''); if (m && lookup(m[1], scope)) for (const c of node.childNodes) proc(c, scope, out); return; }
  if (tag === 'sc-for') {
    const m = WHOLE.exec(node.getAttribute('list') || ''); const arr = m ? lookup(m[1], scope) : []; const as = node.getAttribute('as');
    (arr || []).forEach((it, i) => { const sc = Object.assign({}, scope, { [as]: it, $index: i }); for (const c of node.childNodes) proc(c, sc, out); });
    return;
  }
  const svg = node.namespaceURI === 'http://www.w3.org/2000/svg';
  const el = svg ? document.createElementNS(node.namespaceURI, node.tagName) : document.createElement(tag);
  for (const a of node.attributes) {
    const n = a.name; if (n.startsWith('on') || n.startsWith('hint-')) continue;
    const m = WHOLE.exec(a.value);
    if (m) { const v = lookup(m[1], scope); if (n === 'disabled') { if (v) el.setAttribute(n, ''); continue; } if (v === false || v == null) continue; el.setAttribute(n, String(v)); }
    else el.setAttribute(n, interp(a.value, scope));
  }
  for (const c of node.childNodes) proc(c, scope, el);
  out.appendChild(el);
}
window.DC = {
  boot(code, props) {
    const Comp = new Function('DCLogic', code + '\nreturn Component;')(DCLogic);
    const c = new Comp(props || {}); c.later = () => { }; c.laterRaw = () => { };
    window.comp = c; return c;
  },
  S(fn) { const c = window.comp; const s = JSON.parse(JSON.stringify(c.state)); fn(s, c); c.state = s; },
  render() {
    const app = document.getElementById('app'); app.innerHTML = '';
    const vals = window.comp.renderVals();
    for (const ch of document.getElementById('tpl').content.childNodes) proc(ch, vals, app);
  },
  freeze(ms) { document.getAnimations().forEach((a) => { try { a.pause(); a.currentTime = ms; } catch (e) { } }); },
  rect(sel) { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }
};
