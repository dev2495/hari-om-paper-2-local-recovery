#!/usr/bin/env python3
"""Build the Hari Om TubeOS help guide.

  python3 docs/help-guide/build_guide.py            # HTML handbook + NotebookLM sources
  python3 docs/help-guide/build_guide.py --html     # HTML only
  python3 docs/help-guide/build_guide.py --notebook # NotebookLM sources only

Reads chapters/*.md and screens/*.jpg. Writes dist/ (handbook) and notebooklm-pack/ (sources).
Needs the `markdown` package. macOS `sips` is used to shrink screenshots for embedding (falls back to originals).
"""
import base64, html, json, re, shutil, subprocess, sys
from pathlib import Path

import markdown
from markdown.extensions.toc import slugify as md_slugify

ROOT = Path(__file__).resolve().parent
CHAPTERS = ROOT / "chapters"
SCREENS = ROOT / "screens"
DIST = ROOT / "dist"
SMALL = DIST / ".small"
PACK = ROOT / "notebooklm-pack"
DIST_WEB = ROOT / "dist-web"
WEB = False  # True: images are files next to index.html (for the app); False: embedded in one file
LAYOUT = ROOT.parent.parent / "apps/web-ui/app/(dashboard)/layout.tsx"
AS_OF = "31 October 2026"
TITLE = "Hari Om TubeOS Help Guide"

GROUPS = [
    ("start", "Start here, sales and design", range(0, 10), "#2563eb"),
    ("make", "Production, quality and dispatch", range(10, 20), "#0f766e"),
    ("buy", "Purchasing, stores and inward", range(20, 25), "#d97706"),
    ("run", "Stock control, reports and setup", range(25, 40), "#7c3aed"),
]
ROLE_COLORS = {
    "sales": "#2563eb", "owner": "#7c3aed", "admin": "#7c3aed", "planner": "#0f766e", "operator": "#d97706",
    "qc": "#e11d48", "inward qc": "#e11d48", "in-process qc": "#e11d48", "store": "#16a34a", "grn": "#16a34a",
    "dispatch": "#ea580c", "accounts": "#0891b2", "plant manager": "#4f46e5", "rm issue": "#65a30d", "system": "#64748b",
}


def group_of(num):
    for key, name, rng, color in GROUPS:
        if num in rng:
            return key, name, color
    return "run", GROUPS[-1][1], GROUPS[-1][3]


# ---------------------------------------------------------------- chapters
def load_chapters():
    out = []
    for p in sorted(CHAPTERS.glob("[0-9][0-9]-*.md")):
        text = p.read_text(encoding="utf-8")
        m = re.search(r"^#\s+(.+)$", text, re.M)
        out.append({"num": int(p.name[:2]), "slug": p.stem, "title": m.group(1).strip() if m else p.stem, "text": text, "path": p})
    return out


FLOW_RE = re.compile(r"```flow\n(.*?)\n```", re.S)


def parse_flow(body):
    title, chains = "", []
    for line in body.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        if line.lower().startswith("title:"):
            title = line[6:].strip()
            continue
        label = ""
        mm = re.match(r"after\s+(.+?):\s*(.*)$", line, re.I)
        if mm:
            label, line = mm.group(1).strip(), mm.group(2)
        steps = []
        for raw in line.split("->"):
            raw = raw.strip()
            role = re.search(r"\[(.*?)\]", raw)
            note = re.search(r"\((.*)\)", raw)
            name = re.sub(r"\[.*?\]|\(.*\)", "", raw).strip()
            steps.append({"name": name, "role": role.group(1) if role else "", "note": note.group(1) if note else ""})
        chains.append({"after": label, "steps": steps})
    return title, chains


def role_color(role):
    first = re.split(r"[/,&]", role)[0].strip().lower()
    return ROLE_COLORS.get(first, "#64748b")


def flow_html(body):
    title, chains = parse_flow(body)
    parts = ['<div class="flow">']
    if title:
        parts.append(f'<div class="flow-title">{html.escape(title)}</div>')
    for chain in chains:
        branch = bool(chain["after"])
        parts.append(f'<div class="flow-row{" branch" if branch else ""}">')
        if branch:
            parts.append(f'<span class="flow-from">If it goes wrong after <b>{html.escape(chain["after"])}</b></span>')
        parts.append("<ol>")
        for i, s in enumerate(chain["steps"], 1):
            role = f'<em class="role" style="--rc:{role_color(s["role"])}">{html.escape(s["role"])}</em>' if s["role"] else ""
            note = f'<small>{html.escape(s["note"])}</small>' if s["note"] else ""
            parts.append(f'<li><span class="n">{i}</span><b>{html.escape(s["name"])}</b>{role}{note}</li>')
        parts.append("</ol></div>")
    parts.append("</div>")
    return "".join(parts)


def flow_text(body):
    title, chains = parse_flow(body)
    lines = [f"Flow diagram: {title}" if title else "Flow diagram"]
    for c in chains:
        bits = []
        for i, s in enumerate(c["steps"], 1):
            t = f"{i}. {s['name']}"
            if s["role"]:
                t += f" (done by {s['role']})"
            if s["note"]:
                t += f" - {s['note']}"
            bits.append(t)
        prefix = f"If it goes wrong after '{c['after']}': " if c["after"] else "Steps: "
        lines.append(prefix + " -> ".join(bits))
    return "\n".join(lines)


# ---------------------------------------------------------------- images
def small_image(name):
    src = SCREENS / name
    if not src.exists():
        return None
    SMALL.mkdir(parents=True, exist_ok=True)
    dst = SMALL / name
    if WEB:
        pass
    if not dst.exists():
        width = "900" if name.startswith("m-") else "1000"
        try:
            subprocess.run(["sips", "-Z", width, "-s", "formatOptions", "64", str(src), "--out", str(dst)], check=True, capture_output=True)
        except Exception:
            shutil.copy(src, dst)
    if WEB:
        (DIST_WEB / "screens").mkdir(parents=True, exist_ok=True)
        shutil.copy(dst, DIST_WEB / "screens" / name)
        return f"screens/{name}"
    return "data:image/jpeg;base64," + base64.b64encode(dst.read_bytes()).decode()


MISSING = []

LIST_RE = re.compile(r"^\s*(\d+\.|[-*])\s+")


def fix_lists(text):
    """Python-Markdown needs a blank line before a list; the chapters often omit it."""
    out, fence, prev = [], False, ""
    for line in text.split("\n"):
        if line.strip().startswith("```"):
            fence = not fence
        if (not fence and LIST_RE.match(line) and prev.strip() and not LIST_RE.match(prev)
                and not prev.startswith((" ", "\t", ">", "|", "#"))):
            out.append("")
        out.append(line)
        prev = line
    return "\n".join(out)



def render_chapter(ch):
    text = fix_lists(ch["text"])
    flows = []

    def stash(m):
        flows.append(m.group(1))
        return f"\n\nFLOWBLOCK{len(flows) - 1}END\n\n"

    text = FLOW_RE.sub(stash, text)
    text = re.sub(r"^(> \*\*[^\n]*?)[ ]*$", r"\1  ", text, flags=re.M)
    slug = ch["slug"]
    md = markdown.Markdown(
        extensions=["tables", "fenced_code", "toc", "sane_lists"],
        extension_configs={"toc": {"slugify": lambda v, s: f"{slug}-{md_slugify(v, s)}"}},
    )
    body = md.convert(text)
    for i, f in enumerate(flows):
        body = body.replace(f"<p>FLOWBLOCK{i}END</p>", flow_html(f))

    def fig(m):
        alt, src, cap = re.sub(r"^Alt:\s*", "", m.group(1)), m.group(2), m.group(3)
        name = Path(src).name
        uri = small_image(name)
        if not uri:
            MISSING.append((ch["slug"], name))
            return ""
        cap = cap or f"<em>Figure: {alt}</em>"
        cap = re.sub(r"^<em>(.*)</em>$", r"\1", cap, flags=re.S)
        return f'<figure{" class=phone" if name.startswith("m-") else ""}><img loading="lazy" data-zoom alt="{html.escape(html.unescape(alt))}" src="{uri}"><figcaption>{cap}</figcaption></figure>'

    body = re.sub(r'<p><img alt="(.*?)" src="(.*?)"\s*/?>\s*(?:</p>\s*<p>)?\s*(<em>Figure:.*?</em>)?\s*</p>', fig, body, flags=re.S)
    def inline_img(m):
        uri = small_image(Path(m.group(2)).name)
        if not uri:
            MISSING.append((ch["slug"], Path(m.group(2)).name))
            return ""
        return f'<img loading="lazy" data-zoom alt="{m.group(1)}" src="{uri}" style="max-width:100%">'

    body = re.sub(r'<img alt="(.*?)" src="\.\./screens/(.*?)"\s*/?>', inline_img, body)

    def qa(m):
        q, a = m.group(1).strip(), m.group(2).strip()
        return f'<details class="qa"><summary>{q}</summary><div>{a}</div></details>'

    body = re.sub(r"<p><strong>Q:\s*(.*?)</strong>\s*(?:<br\s*/?>\s*)?A:\s*(.*?)</p>", qa, body, flags=re.S)

    # wrap h2 sections
    parts = re.split(r'(?=<h2 id=")', body)
    wrapped = [parts[0]]
    for part in parts[1:]:
        sid = re.match(r'<h2 id="([^"]+)"', part).group(1)
        cls = re.sub(r"^\d\d-.*?-(?=at-a-glance|the-flow|screen-tour|step-by-step|rules|sample|common|related)", "", sid)
        wrapped.append(f'<section class="sec {html.escape(cls)}">{part}</section>')
    body = "".join(wrapped)
    heads = re.findall(r'<h2 id="([^"]+)">(.*?)</h2>', body)
    return body, heads


# ---------------------------------------------------------------- HTML
CSS = r"""
:root{--bg:#f6f8fa;--panel:#fff;--ink:#0f172a;--muted:#5b6678;--line:#e2e8f0;--brand:#0f766e;--brand-ink:#0b5a54;--brand-soft:#e6f4f2;--warn:#fff7e6;--warn-line:#f5d9a0;--ok:#ecfdf3;--ok-line:#a7e3c0;--code:#f1f5f9;--shadow:0 1px 2px rgba(15,23,42,.06),0 8px 24px rgba(15,23,42,.06)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0b1117;--panel:#121a23;--ink:#e6edf3;--muted:#9aa7b5;--line:#233140;--brand:#2dd4bf;--brand-ink:#5eead4;--brand-soft:#0f2a2a;--warn:#2a2210;--warn-line:#5a4716;--ok:#0f2a1c;--ok-line:#1f5a3a;--code:#18222d;--shadow:none}}
:root[data-theme="dark"]{--bg:#0b1117;--panel:#121a23;--ink:#e6edf3;--muted:#9aa7b5;--line:#233140;--brand:#2dd4bf;--brand-ink:#5eead4;--brand-soft:#0f2a2a;--warn:#2a2210;--warn-line:#5a4716;--ok:#0f2a1c;--ok-line:#1f5a3a;--code:#18222d;--shadow:none}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:76px}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--brand-ink)}
.top{position:sticky;top:0;z-index:20;display:flex;gap:12px;align-items:center;padding:10px 20px;background:color-mix(in srgb,var(--panel) 92%,transparent);backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
.top .brand{font-weight:700;letter-spacing:-.01em;white-space:nowrap}.top .brand span{color:var(--brand)}
.top input{flex:1;max-width:520px;margin-left:auto;padding:9px 14px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);font:inherit;font-size:14px}
.top button{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:10px;padding:8px 12px;cursor:pointer;font:inherit;font-size:14px}
.menu-btn{display:none}
.layout{display:grid;grid-template-columns:300px minmax(0,1fr);max-width:1500px;margin:0 auto}
nav.side{position:sticky;top:57px;height:calc(100vh - 57px);overflow:auto;padding:20px 14px 40px 20px;border-right:1px solid var(--line)}
nav.side h4{margin:18px 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
nav.side a{display:flex;gap:8px;align-items:baseline;padding:6px 10px;border-radius:8px;text-decoration:none;color:var(--ink);font-size:14px;line-height:1.35}
nav.side a:hover{background:var(--brand-soft)}nav.side a.on{background:var(--brand-soft);color:var(--brand-ink);font-weight:600}
nav.side a i{font-style:normal;font-size:11px;color:var(--muted);min-width:20px}
main{padding:28px clamp(16px,4vw,56px) 80px;min-width:0}
.hero{background:linear-gradient(135deg,#0f766e,#115e59 55%,#134e4a);color:#fff;border-radius:20px;padding:44px clamp(22px,4vw,48px);box-shadow:var(--shadow)}
.hero h1{margin:0 0 8px;font-size:clamp(28px,4vw,44px);letter-spacing:-.02em;line-height:1.1;color:#fff}
.hero p{margin:6px 0;max-width:62ch;color:#d6f3ef;font-size:17px}
.hero .chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}.hero .chips span{background:rgba(255,255,255,.14);padding:5px 12px;border-radius:999px;font-size:13px}
.how{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:22px 0}
.how div{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:var(--shadow)}.how b{display:block;margin-bottom:4px}.how p{margin:0;color:var(--muted);font-size:14px}
.grp{margin:34px 0 10px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
.card{display:block;text-decoration:none;color:var(--ink);background:var(--panel);border:1px solid var(--line);border-top:4px solid var(--gc);border-radius:14px;padding:14px 16px;box-shadow:var(--shadow);transition:transform .15s}
.card:hover{transform:translateY(-2px)}.card small{color:var(--muted);font-size:12px}.card b{display:block;font-size:16px;margin-top:2px}.card p{margin:6px 0 0;color:var(--muted);font-size:13px;line-height:1.45}
.chapter{margin-top:64px;padding-top:8px}
.chapter>h1{font-size:clamp(26px,3.4vw,38px);line-height:1.15;letter-spacing:-.02em;margin:0 0 14px;padding-left:16px;border-left:6px solid var(--gc)}
.chapter>h1 small{display:block;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600;margin-bottom:4px}
.chapter blockquote:first-of-type{margin:0 0 18px;padding:14px 18px;background:var(--brand-soft);border:1px solid var(--line);border-radius:12px}.chapter blockquote p{margin:3px 0}
h2{font-size:22px;margin:0 0 10px;letter-spacing:-.01em}h3{font-size:17px;margin:22px 0 6px;color:var(--brand-ink)}
section.sec{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:22px clamp(16px,3vw,28px);margin:16px 0;box-shadow:var(--shadow)}
section.sec.rules-the-system-enforces{background:var(--warn);border-color:var(--warn-line)}section.sec.sample{background:var(--ok);border-color:var(--ok-line)}
section.sec.at-a-glance{background:var(--brand-soft)}
section.sec h2::before{content:"";display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--gc);margin-right:10px}
table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px;display:block;overflow-x:auto}th,td{border:1px solid var(--line);padding:7px 10px;text-align:left;vertical-align:top}th{background:var(--code)}
code{background:var(--code);padding:1px 6px;border-radius:5px;font-size:.9em}pre{background:var(--code);padding:12px;border-radius:10px;overflow:auto}
figure{margin:18px 0;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:var(--bg)}figure img{display:block;width:100%;height:auto;cursor:zoom-in}
figcaption{padding:10px 14px;font-size:14px;color:var(--muted);border-top:1px solid var(--line);background:var(--panel)}figcaption em{font-style:normal}
figure.phone img{max-width:300px;margin:0 auto;border-left:1px solid var(--line);border-right:1px solid var(--line)}
.flow{margin:18px 0;padding:16px;border:1px solid var(--line);border-radius:14px;background:linear-gradient(180deg,var(--panel),var(--bg))}
.flow-title{font-weight:700;margin-bottom:12px}.flow-row{margin:10px 0}.flow-row.branch{margin-left:18px;padding-left:14px;border-left:3px dashed var(--warn-line)}
.flow-from{display:block;font-size:12px;color:var(--muted);margin-bottom:6px}
.flow ol{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:12px 30px}
.flow li{position:relative;display:flex;flex-direction:column;gap:3px;align-items:flex-start;min-width:118px;max-width:215px;padding:10px 12px 10px 38px;background:var(--panel);border:1px solid var(--line);border-radius:12px;box-shadow:0 1px 2px rgba(15,23,42,.06)}
.flow li:not(:last-child)::after{content:"";position:absolute;right:-24px;top:50%;width:18px;height:2px;background:var(--brand)}
.flow li:not(:last-child)::before{content:"";position:absolute;right:-26px;top:calc(50% - 4px);border:5px solid transparent;border-left:7px solid var(--brand);border-right:0}
.flow .n{position:absolute;left:10px;top:10px;width:20px;height:20px;border-radius:50%;background:var(--brand);color:#fff;font-size:11px;display:grid;place-items:center;font-weight:700}
.flow b{font-size:14px;line-height:1.3}.flow .role{white-space:normal;line-height:1.3;font-style:normal;font-size:11px;font-weight:600;color:var(--rc);background:color-mix(in srgb,var(--rc) 12%,transparent);padding:1px 8px;border-radius:999px}
.flow small{color:var(--muted);font-size:12px;line-height:1.35}
details.qa{border:1px solid var(--line);border-radius:12px;margin:8px 0;background:var(--bg)}details.qa summary{cursor:pointer;padding:11px 14px;font-weight:600;list-style:none}details.qa summary::before{content:"?";display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:var(--brand);color:#fff;font-size:12px;margin-right:10px}details.qa div{padding:0 14px 12px 44px}
.hit{background:#fde68a;color:#000;border-radius:3px}
#results{display:none;position:fixed;top:60px;right:20px;width:min(520px,calc(100vw - 32px));max-height:70vh;overflow:auto;background:var(--panel);border:1px solid var(--line);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.25);z-index:30;padding:6px}
#results a{display:block;padding:9px 12px;border-radius:8px;text-decoration:none;color:var(--ink);font-size:14px}#results a:hover{background:var(--brand-soft)}#results small{display:block;color:var(--muted)}
#lightbox{display:none;position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:50;align-items:center;justify-content:center;padding:20px;cursor:zoom-out}#lightbox img{max-width:100%;max-height:100%;border-radius:8px}
footer{margin-top:60px;color:var(--muted);font-size:13px;text-align:center}
html.embed .top .brand,html.embed #theme{display:none}html.embed .top input{margin-left:0;max-width:none}html.embed .hero{display:none}
@media (max-width:980px){.layout{grid-template-columns:1fr}nav.side{display:none;position:fixed;inset:57px 0 0 0;height:auto;background:var(--panel);z-index:25}nav.side.open{display:block}.menu-btn{display:inline-block}}
@media print{@page{size:A4;margin:14mm 12mm}body{background:#fff;font-size:11pt}.top,nav.side,#results,#lightbox{display:none!important}.layout{display:block}main{padding:0}
.chapter{break-before:page;margin-top:0}.hero{box-shadow:none;-webkit-print-color-adjust:exact;print-color-adjust:exact}figure,.flow,details.qa{break-inside:avoid}section.sec{box-shadow:none}
section.sec,.flow li,.chapter blockquote,th{-webkit-print-color-adjust:exact;print-color-adjust:exact}.cards .card{break-inside:avoid}h2,h3{break-after:avoid}figure img{cursor:auto}}
"""

JS = r"""
(function(){
var $=function(s,r){return (r||document).querySelector(s)},$$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
try{var t=localStorage.getItem('hg-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}
try{var qp=new URLSearchParams(location.search),th=qp.get('theme');if(th==='dark'||th==='light')document.documentElement.setAttribute('data-theme',th);if(qp.get('embed')==='1')document.documentElement.classList.add('embed')}catch(e){}
$('#theme').onclick=function(){var cur=document.documentElement.getAttribute('data-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');var n=cur==='dark'?'light':'dark';document.documentElement.setAttribute('data-theme',n);try{localStorage.setItem('hg-theme',n)}catch(e){}};
$('#menu').onclick=function(){$('nav.side').classList.toggle('open')};
$$('nav.side a').forEach(function(a){a.addEventListener('click',function(){$('nav.side').classList.remove('open')})});
var chapters=$$('.chapter'),links={};$$('nav.side a[data-ch]').forEach(function(a){links[a.dataset.ch]=a});
if('IntersectionObserver' in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){Object.keys(links).forEach(function(k){links[k].classList.remove('on')});var l=links[e.target.id];if(l)l.classList.add('on')}})},{rootMargin:'-30% 0px -60% 0px'});chapters.forEach(function(c){io.observe(c)})}
var lb=$('#lightbox');document.addEventListener('click',function(e){var im=e.target.closest&&e.target.closest('img[data-zoom]');if(im){lb.firstChild.src=im.src;lb.style.display='flex'}else if(e.target.closest&&e.target.closest('#lightbox')){lb.style.display='none'}});
document.addEventListener('keydown',function(e){if(e.key==='Escape'){lb.style.display='none';$('#results').style.display='none'}if((e.key==='k'&&(e.metaKey||e.ctrlKey))||e.key==='/'&&document.activeElement.tagName!=='INPUT'){e.preventDefault();$('#q').focus()}});
var idx=[];chapters.forEach(function(c){var ct=$('h1',c).textContent;$$('section.sec',c).forEach(function(s){var h=$('h2',s);idx.push({id:h.id,ch:ct,h:h.textContent,t:s.textContent.replace(/\s+/g,' ')})})});
var box=$('#results');$('#q').addEventListener('input',function(){var q=this.value.trim().toLowerCase();if(q.length<2){box.style.display='none';return}
var words=q.split(/\s+/),hits=[];idx.forEach(function(r){var tl=(r.ch+' '+r.h+' '+r.t).toLowerCase(),ok=words.every(function(w){return tl.indexOf(w)>-1});if(ok){var p=tl.indexOf(words[0]),s=r.t.substr(Math.max(0,p-60),170);hits.push({r:r,score:(r.h.toLowerCase().indexOf(words[0])>-1?2:0)+(r.ch.toLowerCase().indexOf(words[0])>-1?1:0),s:s})}});
hits.sort(function(a,b){return b.score-a.score});box.innerHTML=hits.slice(0,12).map(function(h){return '<a href="#'+h.r.id+'"><b>'+h.r.ch+'</b> &rsaquo; '+h.r.h+'<small>&hellip;'+h.s.replace(/</g,'&lt;')+'&hellip;</small></a>'}).join('')||'<a>No match. Try another word.</a>';box.style.display='block'});
box.addEventListener('click',function(){box.style.display='none'});
window.addEventListener('beforeprint',function(){$$('details').forEach(function(d){d.open=true})});
})();
"""


def build_html(chapters):
    side, cards, body = [], [], []
    last_group = None
    for ch in chapters:
        key, gname, color = group_of(ch["num"])
        rendered, heads = render_chapter(ch)
        ch["html"], ch["heads"], ch["color"], ch["group"] = rendered, heads, color, gname
        cid = f"ch-{ch['num']:02d}"
        if gname != last_group:
            side.append(f"<h4>{html.escape(gname)}</h4>")
            cards.append(f'<div class="grp">{html.escape(gname)}</div><div class="cards">' if last_group is None else f'</div><div class="grp">{html.escape(gname)}</div><div class="cards">')
            last_group = gname
        side.append(f'<a href="#{cid}" data-ch="{cid}"><i>{ch["num"]:02d}</i>{html.escape(ch["title"])}</a>')
        m = re.search(r"\*\*What it is:\*\*\s*(.+)", ch["text"])
        what = html.escape(re.sub(r"[*_`]", "", m.group(1))) if m else ""
        cards.append(f'<a class="card" style="--gc:{color}" href="#{cid}"><small>Chapter {ch["num"]:02d}</small><b>{html.escape(ch["title"])}</b><p>{what}</p></a>')
        title_html = f'<h1><small>{html.escape(gname)}</small>{rendered.split("</h1>", 1)[0].split(">", 1)[1]}</h1>'
        body.append(f'<article class="chapter" id="{cid}" style="--gc:{color}">{title_html}{rendered.split("</h1>", 1)[1]}</article>')
    cards.append("</div>")
    hero = f"""<header class="hero"><div style="opacity:.8;font-size:13px;letter-spacing:.12em;text-transform:uppercase">Paper tube manufacturing ERP</div>
<h1>{TITLE}</h1><p>Everything you need to run orders, planning, the shop floor, quality, purchasing, stores and reports in TubeOS. Written in plain words, with the real screens, flow diagrams and worked samples.</p>
<div class="chips"><span>{len(chapters)} chapters</span><span>Real screenshots</span><span>Flow diagrams</span><span>Worked samples</span><span>As of {AS_OF}</span></div></header>
<div class="how"><div><b>Find it fast</b><p>Press <code>/</code> or Ctrl/Cmd+K and type a word, such as <i>reject</i>, <i>GRN</i> or <i>Split plan</i>.</p></div>
<div><b>Start with your job</b><p>Open <a href="#ch-06">A day in the life</a> for your role, then follow its links.</p></div>
<div><b>See how it fits</b><p>Chapter <a href="#ch-00">00</a> shows how the plant flows from customer order to dispatch and from supplier to shop floor.</p></div>
<div><b>Print or share</b><p>This page prints cleanly to PDF. Click any screenshot to enlarge it.</p></div></div>
{"".join(cards)}"""
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{TITLE}</title><meta name="description" content="Plain-language guide to every page of Hari Om TubeOS, with screenshots, flow diagrams and samples."><style>{CSS}</style></head><body>
<div class="top"><button class="menu-btn" id="menu" aria-label="Menu">Menu</button><div class="brand">Hari Om <span>TubeOS</span> Help</div><input id="q" type="search" placeholder="Search the guide  ( / )" aria-label="Search the guide"><button id="theme" aria-label="Switch light or dark">Light/Dark</button></div>
<div id="results"></div><div id="lightbox"><img alt=""></div>
<div class="layout"><nav class="side" aria-label="Chapters"><a href="#top">Home</a>{"".join(side)}</nav>
<main id="top">{hero}{"".join(body)}<footer>{TITLE} &middot; as of {AS_OF} &middot; Hari Om TubeOS</footer></main></div><script>{JS}</script></body></html>"""
    DIST.mkdir(exist_ok=True)
    if WEB:
        DIST_WEB.mkdir(exist_ok=True)
        out = DIST_WEB / "index.html"
        out.write_text(page, encoding="utf-8")
        print(f"WEB HTML: {out} ({out.stat().st_size / 1e6:.2f} MB)")
        return
    out = DIST / "Hari-Om-TubeOS-Help-Guide.html"
    out.write_text(page, encoding="utf-8")
    (DIST / "chapters.json").write_text(json.dumps([{"id": f"ch-{c['num']:02d}", "num": c["num"], "slug": c["slug"], "title": c["title"], "file": f"S{c['num']:02d}_{c['slug'][3:]}"} for c in chapters], indent=1), encoding="utf-8")
    print(f"HTML: {out} ({out.stat().st_size / 1e6:.1f} MB), chapters={len(chapters)}, missing images={MISSING}")


# ---------------------------------------------------------------- NotebookLM pack
def notebook_text(ch):
    text = fix_lists(ch["text"])
    text = FLOW_RE.sub(lambda m: "\n" + flow_text(m.group(1)) + "\n", text)
    text = re.sub(r"!\[(.*?)\]\(\.\./screens/(.*?)\.jpg\)", lambda m: f'[Screenshot "{m.group(2)}": {m.group(1).removeprefix("Alt:").strip()}]', text)
    _, gname, _ = group_of(ch["num"])
    head = (f"HARI OM TUBEOS HELP GUIDE - Chapter {ch['num']:02d}: {ch['title']}\nSection: {gname}. Accurate as of {AS_OF}. "
            f"Hari Om TubeOS is the ERP for a paper tube plant (sales orders, planning, shop floor, quality, purchasing, stores, reports).\n"
            f"Screenshots named in this file are in the visual handbook (Hari-Om-TubeOS-Help-Guide.html or .pdf), chapter {ch['num']:02d}.\n\n")
    return head + text


def section_of(text, name_re):
    m = re.search(rf"^##\s+{name_re}.*?$(.*?)(?=^##\s|\Z)", text, re.S | re.M)
    return m.group(1).strip() if m else ""


def nav_index():
    """Pages, groups, descriptions and roles from the sidebar definition in layout.tsx."""
    if not LAYOUT.exists():
        return ""
    src = LAYOUT.read_text(encoding="utf-8")
    out = ["# TubeOS page index: every sidebar page, what it is for and who can see it\n",
           "Owner and Admin can open every page. A page with no roles listed is open to all signed-in users.\n"]
    for block in re.split(r'\n\s*title:\s*"', src)[1:]:
        group = block.split('"', 1)[0]
        if group not in {"Overview", "Operations", "Quality", "Purchasing", "Stores & inventory", "Design", "Reports", "Foundation"}:
            continue
        out.append(f"\n## Sidebar group: {group}\n")
        for obj in re.findall(r"\{[^{}]*?name:\s*\"[^\"]+\"[^{}]*?href:\s*\"[^\"]+\"[^{}]*?\}", block):
            n = re.search(r'name:\s*"([^"]+)"', obj).group(1)
            h = re.search(r'href:\s*"([^"]+)"', obj).group(1)
            d = re.search(r'description:\s*"((?:[^"\\]|\\.)*)"', obj)
            r = re.search(r"roles:\s*\[(.*?)\]", obj)
            roles = ", ".join(re.findall(r'"([^"]+)"', r.group(1))) if r else "all signed-in users"
            if "ownerOnly" in obj:
                roles = "Owner only"
            out.append(f"- **{n}** (address {h}): {d.group(1) if d else ''} Roles that see it: {roles} (plus Owner and Admin).")
    return "\n".join(out) + "\n"


def build_notebook(chapters):
    srcdir = PACK / "sources-markdown"
    if srcdir.exists():
        shutil.rmtree(srcdir)
    srcdir.mkdir(parents=True)
    for ch in chapters:
        (srcdir / f"S{ch['num']:02d}_{ch['slug'][3:]}.md").write_text(notebook_text(ch), encoding="utf-8")
    faq, samples = [f"# Hari Om TubeOS: all common questions and answers (collected from every chapter)\nAccurate as of {AS_OF}.\n"], \
                   [f"# Hari Om TubeOS: all worked samples and examples (collected from every chapter)\nAccurate as of {AS_OF}. Values are examples, not real customers.\n"]
    for ch in chapters:
        q = section_of(ch["text"], "Common questions")
        s = section_of(ch["text"], "Sample")
        if q:
            faq.append(f"\n## From chapter {ch['num']:02d}: {ch['title']}\n\n{q}\n")
        if s:
            samples.append(f"\n## From chapter {ch['num']:02d}: {ch['title']}\n\n{FLOW_RE.sub(lambda m: flow_text(m.group(1)), s)}\n")
    (srcdir / "S91_all_questions_and_answers.md").write_text("\n".join(faq), encoding="utf-8")
    (srcdir / "S92_all_worked_samples.md").write_text("\n".join(samples), encoding="utf-8")
    idx = nav_index()
    if idx:
        (srcdir / "S93_page_index_and_roles.md").write_text(idx, encoding="utf-8")
    gl = ROOT / "glossary.md"
    if gl.exists():
        ch0 = next((c for c in chapters if c["num"] == 0), None)
        extra = ""
        if ch0:
            for name in ("Status cheat sheet", "Numbering formats"):
                sec = section_of(ch0["text"], name)
                if sec:
                    extra += f"\n\n## {name} (from chapter 00)\n\n{sec}\n"
        (srcdir / "S90_glossary_statuses_and_numbering.md").write_text(gl.read_text(encoding="utf-8") + extra, encoding="utf-8")
    words = sum(len(p.read_text(encoding="utf-8").split()) for p in srcdir.glob("*.md"))
    print(f"NotebookLM sources: {len(list(srcdir.glob('*.md')))} files, {words:,} words -> {srcdir}")



def build_extras_html():
    """Glossary, Q&A, samples and page index as one printable HTML (each article becomes its own PDF)."""
    srcdir = PACK / "sources-markdown"
    items = []
    for f in sorted(srcdir.glob("S9*.md")):
        md = markdown.Markdown(extensions=["tables", "fenced_code", "sane_lists"])
        body = md.convert(fix_lists(f.read_text(encoding="utf-8")))
        title = re.search(r"<h1>(.*?)</h1>", body)
        items.append({"id": f"x-{f.stem}", "file": f.stem, "title": re.sub(r"<.*?>", "", title.group(1)) if title else f.stem, "body": body})
    arts = "".join(f'<article class="chapter" id="{i["id"]}" style="--gc:#0f766e">{i["body"]}</article>' for i in items)
    page = f"<!doctype html><html lang=en><head><meta charset=utf-8><title>{TITLE} extras</title><style>{CSS} .layout{{display:block}} main{{padding:0 8px}}</style></head><body><main>{arts}</main></body></html>"
    (DIST / "_extras.html").write_text(page, encoding="utf-8")
    (DIST / "extras.json").write_text(json.dumps([{k: v for k, v in i.items() if k != "body"} for i in items], indent=1), encoding="utf-8")
    print(f"extras: {len(items)} articles")


APP = ROOT.parent.parent / "apps/web-ui"


def write_chapters_ts():
    chapters = json.loads((DIST / "chapters.json").read_text())
    extras = json.loads((DIST / "extras.json").read_text())
    rows = ",\n".join(
        f'  {{ id: "{c["id"]}", num: {c["num"]}, title: {json.dumps(c["title"])}, group: {json.dumps(group_of(c["num"])[1])}, file: "{c["file"]}" }}' for c in chapters
    )
    ex = ",\n".join(f'  {{ file: "{e["file"]}", title: {json.dumps(e["title"])} }}' for e in extras)
    (APP / "lib/handbook-chapters.ts").write_text(
        "// Generated by docs/help-guide/build_guide.py --publish. Do not edit by hand.\n"
        "export type HandbookChapter = { id: string; num: number; title: string; group: string; file: string }\n"
        f"export const HANDBOOK_CHAPTERS: HandbookChapter[] = [\n{rows},\n]\n"
        f"export const HANDBOOK_EXTRAS: { '{' } file: string; title: string { '}' }[] = [\n{ex},\n]\n",
        encoding="utf-8",
    )
    print("wrote lib/handbook-chapters.ts")


def publish_to_app():
    """Copy the web handbook and PDFs into apps/web-ui/public/docs and write lib/handbook-chapters.ts."""
    docs = APP / "public/docs"
    hb = docs / "handbook"
    if hb.exists():
        shutil.rmtree(hb)
    shutil.copytree(DIST_WEB, hb)
    chap = docs / "chapters"
    if chap.exists():
        shutil.rmtree(chap)
    chap.mkdir(parents=True)
    chapters = json.loads((DIST / "chapters.json").read_text())
    extras = json.loads((DIST / "extras.json").read_text())
    for item in chapters + extras:
        src = PACK / "sources" / f"{item['file']}.pdf"
        if src.exists():
            shutil.copy(src, chap / src.name)
    shutil.copy(DIST / "Hari-Om-TubeOS-Help-Guide.pdf", docs / "Hari-Om-TubeOS-Help-Guide.pdf")
    write_chapters_ts()
    print(f"published to {docs}")


if __name__ == "__main__":
    chapters = load_chapters()
    if not chapters:
        sys.exit("no chapters found")
    if "--ts" in sys.argv:
        write_chapters_ts()
        sys.exit(0)
    if "--publish" in sys.argv:
        publish_to_app()
        sys.exit(0)
    want_html = "--notebook" not in sys.argv
    want_nb = "--html" not in sys.argv
    if want_html:
        build_html(chapters)
        WEB = True
        build_html(chapters)
        WEB = False
    if want_nb:
        build_notebook(chapters)
        build_extras_html()
