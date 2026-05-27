from __future__ import annotations

import os
import smtplib
from datetime import date, datetime
from email.message import EmailMessage
from io import BytesIO
from pathlib import Path
from typing import Any

import requests
from jinja2 import Template
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from src.config import AUTH_SERVICE_URL

INTERNAL_EVENT_TOKEN = os.getenv("INTERNAL_EVENT_TOKEN", "hariom-internal-events")
OUTPUT_DIR = Path(os.getenv("OWNER_PACK_OUTPUT_DIR", Path(__file__).resolve().parents[3] / "output" / "pdf"))


OWNER_PACK_TEMPLATE = Template(
    """
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>{{ title }}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3efe6;
        --ink: #12202c;
        --muted: #617485;
        --panel: rgba(255,255,255,0.88);
        --border: rgba(18,32,44,0.12);
        --teal: #0e6a77;
        --amber: #cb6d1d;
        --slate: #1e293b;
        --rose: #aa3a52;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at 0 0, rgba(14,106,119,0.18), transparent 28%),
          radial-gradient(circle at 100% 0, rgba(203,109,29,0.12), transparent 24%),
          linear-gradient(180deg, #f6f2e8 0%, #efe7da 100%);
      }
      .page { padding: 28px; }
      .hero {
        background: linear-gradient(135deg, #082f49 0%, #125b74 52%, #0f172a 100%);
        color: white;
        border-radius: 28px;
        padding: 28px;
        box-shadow: 0 25px 70px rgba(15, 23, 42, 0.22);
      }
      .eyebrow {
        font-size: 11px;
        letter-spacing: 0.18em;
        text-transform: uppercase;
        opacity: 0.75;
      }
      .hero h1 {
        margin: 10px 0 8px;
        font-size: 34px;
      }
      .hero-meta {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 16px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        border-radius: 999px;
        background: rgba(255,255,255,0.12);
        padding: 8px 12px;
        font-size: 12px;
      }
      .metrics {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 14px;
        margin-top: 18px;
      }
      .metric {
        border: 1px solid rgba(255,255,255,0.14);
        border-radius: 20px;
        padding: 16px;
        background: rgba(255,255,255,0.08);
      }
      .metric label {
        display: block;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        opacity: 0.8;
      }
      .metric strong {
        display: block;
        margin-top: 10px;
        font-size: 28px;
      }
      .grid {
        display: grid;
        grid-template-columns: 1.2fr 0.8fr;
        gap: 18px;
        margin-top: 18px;
      }
      .panel {
        border-radius: 24px;
        padding: 20px;
        background: var(--panel);
        border: 1px solid var(--border);
        box-shadow: 0 18px 48px rgba(15,23,42,0.08);
      }
      .panel h2 {
        margin: 0;
        font-size: 20px;
      }
      .panel p.sub {
        margin: 6px 0 0;
        color: var(--muted);
        font-size: 13px;
      }
      .chart {
        margin-top: 16px;
        display: grid;
        grid-template-columns: repeat({{ throughput|length or 1 }}, minmax(0, 1fr));
        gap: 12px;
        align-items: end;
        min-height: 210px;
      }
      .bar {
        display: flex;
        flex-direction: column;
        justify-content: end;
        gap: 8px;
      }
      .bar-stack {
        display: flex;
        align-items: end;
        gap: 4px;
        height: 170px;
      }
      .bar-stack span {
        display: block;
        width: 100%;
        border-radius: 10px 10px 4px 4px;
      }
      .bar label {
        font-size: 11px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }
      .kpis {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
        margin-top: 16px;
      }
      .kpi {
        border-radius: 18px;
        padding: 14px;
        background: #fff;
        border: 1px solid var(--border);
      }
      .kpi strong {
        display: block;
        margin-top: 8px;
        font-size: 24px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin-top: 16px;
        font-size: 13px;
      }
      th, td {
        padding: 10px 8px;
        border-bottom: 1px solid rgba(18,32,44,0.08);
        text-align: left;
      }
      th {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: var(--muted);
      }
      .section {
        margin-top: 18px;
      }
    </style>
  </head>
  <body>
    <div class="page">
      <section class="hero">
        <div class="eyebrow">Hari Om Paper · Daily Owner Pack</div>
        <h1>{{ title }}</h1>
        <div>{{ subtitle }}</div>
        <div class="hero-meta">
          <span class="pill">Generated {{ generated_at }}</span>
          <span class="pill">{{ plant_scope }}</span>
          <span class="pill">{{ filter_date }}</span>
        </div>
        <div class="metrics">
          {% for metric in metrics %}
          <div class="metric">
            <label>{{ metric.label }}</label>
            <strong>{{ metric.value }}</strong>
            <div>{{ metric.detail }}</div>
          </div>
          {% endfor %}
        </div>
      </section>

      <div class="grid">
        <section class="panel">
          <h2>Production Throughput</h2>
          <p class="sub">Daily execution movement across the route.</p>
          <div class="chart">
            {% for row in throughput %}
            <div class="bar">
              <div class="bar-stack">
                <span style="height: {{ row.winder_height }}px; background: #0e6a77;"></span>
                <span style="height: {{ row.process_height }}px; background: #cb6d1d;"></span>
                <span style="height: {{ row.dispatch_height }}px; background: #293448;"></span>
              </div>
              <label>{{ row.label }}</label>
            </div>
            {% endfor %}
          </div>
        </section>

        <section class="panel">
          <h2>Exception Snapshot</h2>
          <p class="sub">Signals that need leadership attention.</p>
          <div class="kpis">
            {% for kpi in exception_kpis %}
            <div class="kpi">
              <div>{{ kpi.label }}</div>
              <strong>{{ kpi.value }}</strong>
              <div>{{ kpi.detail }}</div>
            </div>
            {% endfor %}
          </div>
        </section>
      </div>

      <div class="grid">
        <section class="panel">
          <h2>Delayed Orders</h2>
          <p class="sub">Open demand slipping beyond committed dates.</p>
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {% for row in delayed_orders %}
              <tr><td>{{ row.order_no }}</td><td>{{ row.customer_name }}</td><td>{{ row.due_date or '-' }}</td><td>{{ row.status }}</td></tr>
              {% endfor %}
            </tbody>
          </table>
        </section>

        <section class="panel">
          <h2>Low Stock Risk</h2>
          <p class="sub">Items under immediate availability pressure.</p>
          <table>
            <thead><tr><th>Item</th><th>Name</th><th>Qty</th></tr></thead>
            <tbody>
              {% for row in low_stock %}
              <tr><td>{{ row.item_code }}</td><td>{{ row.name }}</td><td>{{ row.available_qty }}</td></tr>
              {% endfor %}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  </body>
</html>
"""
)


def _metric(value: Any, suffix: str = "", digits: int = 0) -> str:
    number = float(value or 0)
    return f"{number:,.{digits}f}{suffix}" if digits else f"{number:,.0f}{suffix}"


def _throughput_rows(report: dict[str, Any]) -> list[dict[str, Any]]:
    rows = (report.get("production", {}) or {}).get("series") or []
    rows = rows[-7:] if len(rows) > 7 else rows
    max_value = max(
        [
            max(float(row.get("winder_qty") or 0), float(row.get("process_qty") or 0), float(row.get("dispatch_qty") or 0))
            for row in rows
        ] or [1]
    )
    height = 148.0
    result = []
    for row in rows:
        result.append(
            {
                "label": row.get("bucket") or row.get("label") or "-",
                "winder_height": max(10.0, (float(row.get("winder_qty") or 0) / max_value) * height) if max_value else 10.0,
                "process_height": max(10.0, (float(row.get("process_qty") or 0) / max_value) * height) if max_value else 10.0,
                "dispatch_height": max(10.0, (float(row.get("dispatch_qty") or 0) / max_value) * height) if max_value else 10.0,
            }
        )
    return result or [{"label": "No data", "winder_height": 10.0, "process_height": 10.0, "dispatch_height": 10.0}]


def _display_plant_scope(value: Any) -> str:
    normalized = str(value or "").strip()
    if not normalized or normalized.upper() == "ALL":
        return "All Visible Plants"
    labels = {
        "00000000-0000-0000-0000-0000000000a1": "Plant A",
        "00000000-0000-0000-0000-0000000000b2": "Plant B",
        "PLANT_A": "Plant A",
        "PLANT_B": "Plant B",
    }
    return labels.get(normalized) or labels.get(normalized.upper()) or normalized


def build_owner_pack_context(report: dict[str, Any], *, report_date: date | None = None) -> dict[str, Any]:
    report_date = report_date or date.today()
    headline = report.get("headline", {}) or {}
    exceptions = report.get("exceptions", {}) or {}
    inventory = report.get("inventory", {}) or {}
    sales = report.get("sales", {}) or {}
    production = report.get("production", {}) or {}
    quality = report.get("quality", {}) or {}
    dispatch = report.get("dispatch", {}) or {}
    filters = report.get("filters", {}) or {}
    available_range = report.get("available_range", {}) or {}

    return {
        "title": f"Owner Close Pack · {report_date.isoformat()}",
        "subtitle": "Production, stock, quality, dispatch, and exception truth aligned on one board-ready surface.",
        "generated_at": datetime.now().strftime("%d %b %Y, %H:%M"),
        "filter_date": f"{filters.get('start_date')} to {filters.get('end_date')}",
        "plant_scope": _display_plant_scope(filters.get("plant_scope")),
        "available_range": available_range,
        "metrics": [
            {"label": "Active Job Cards", "value": _metric(headline.get("active_job_cards")), "detail": "Execution cards still in play"},
            {"label": "Dispatch Qty", "value": _metric(headline.get("dispatch_qty")), "detail": "Closed or recorded movement"},
            {"label": "Inventory Value", "value": _metric(headline.get("inventory_value")), "detail": "RM + WIP + FG"},
            {"label": "OTIF", "value": _metric(headline.get("otif_percent"), "%", 1), "detail": "Closed orders on time"},
        ],
        "throughput": _throughput_rows(report),
        "exception_kpis": [
            {"label": "Blocked Jobs", "value": _metric(headline.get("blocked_jobs")), "detail": "Execution cards blocked"},
            {"label": "QC Holds", "value": _metric(headline.get("active_qc_holds")), "detail": "Active quality hold state"},
            {"label": "Low Stock", "value": _metric(headline.get("low_stock_items")), "detail": "Items below availability threshold"},
            {"label": "Ready Jobs", "value": _metric(dispatch.get("summary", {}).get("ready_job_count")), "detail": "Dispatch-ready jobs"},
            {"label": "Adherence", "value": _metric(production.get("summary", {}).get("schedule_adherence_percent"), "%", 1), "detail": "Planned vs actual day match"},
            {"label": "Compliance", "value": _metric(quality.get("summary", {}).get("compliance_percent"), "%", 1), "detail": "Inspections passing"},
        ],
        "delayed_orders": (sales.get("delayed_rows") or [])[:8],
        "low_stock": (inventory.get("risk_items", {}) or {}).get("low_stock", [])[:8],
        "sections": {
            "summary": {
                "blocked_jobs": headline.get("blocked_jobs") or 0,
                "active_qc_holds": headline.get("active_qc_holds") or 0,
                "low_stock_items": headline.get("low_stock_items") or 0,
                "otif_percent": headline.get("otif_percent") or 0,
            }
        },
    }


def render_owner_pack_html(report: dict[str, Any], *, report_date: date | None = None) -> str:
    context = build_owner_pack_context(report, report_date=report_date)
    return OWNER_PACK_TEMPLATE.render(**context)


# ──────────────────────────────────────────────────────────────────────────
# Premium PDF rendering
#
# Layout philosophy:
#   * Cover page with full-bleed gradient hero, plant scope, period, "owner
#     daily pack" branding, 4 hero KPIs.
#   * Page 2: variance waterfall (theoretical → actual) + dispatch trend.
#   * Page 3: exception KPI strip + delayed-orders + low-stock tables.
#   * Every page gets a header band and a footer with page number / "confidential".
#   * Numbers are formatted via _metric so blanks render as 0 not "None".
# ──────────────────────────────────────────────────────────────────────────


_PDF_BRAND_TEAL = "#0e6a77"
_PDF_BRAND_TEAL_DEEP = "#083344"
_PDF_BRAND_INK = "#0f172a"
_PDF_BRAND_AMBER = "#b45309"
_PDF_BRAND_EMERALD = "#047857"
_PDF_BRAND_ROSE = "#be123c"
_PDF_BRAND_SLATE = "#475569"
_PDF_BRAND_BG = "#f8fafc"
_PDF_BRAND_LINE = "#cbd5e1"


def _safe_num(value: Any) -> float:
    try:
        n = float(value)
        if n != n:  # NaN
            return 0.0
        return n
    except (TypeError, ValueError):
        return 0.0


def _waterfall_bars(report: dict[str, Any]) -> list[dict[str, Any]]:
    """Build the six-bar theoretical→actual waterfall for the owner pack PDF.

    Falls back gracefully — if reconciliation isn't populated yet, returns a
    minimal anchor pair so the chart panel doesn't blow up.
    """
    rec_summary = ((report.get("reconciliation") or {}).get("summary") or {})
    theoretical = _safe_num(rec_summary.get("theoretical_kg"))
    over_issue = _safe_num(rec_summary.get("over_issue_kg"))
    recovery = _safe_num(rec_summary.get("recovery_kg"))
    moisture = _safe_num(rec_summary.get("moisture_kg"))
    scrap = _safe_num(rec_summary.get("scrap_kg"))
    actual = _safe_num(rec_summary.get("actual_kg")) or (theoretical - over_issue + recovery - moisture - scrap)
    bars: list[dict[str, Any]] = [
        {"label": "Theoretical", "value": theoretical, "total": True, "tone": "anchor"},
    ]
    if over_issue:
        bars.append({"label": "Over-issue", "value": -over_issue, "tone": "negative"})
    if recovery:
        bars.append({"label": "Recovery", "value": recovery, "tone": "positive"})
    if moisture:
        bars.append({"label": "Moisture", "value": -moisture, "tone": "negative"})
    if scrap:
        bars.append({"label": "Scrap", "value": -scrap, "tone": "negative"})
    bars.append({"label": "Actual", "value": actual, "total": True, "tone": "anchor"})
    return bars


def _draw_page_chrome(pdf: "canvas.Canvas", width: float, height: float, page_label: str, context: dict[str, Any]) -> None:
    """Header band + footer (page number, period, confidentiality)."""
    # Top thin band
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_TEAL_DEEP))
    pdf.rect(0, height - 12 * mm, width, 12 * mm, stroke=0, fill=1)
    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawString(18 * mm, height - 8 * mm, "Hari Om Paper · Owner Daily Pack")
    pdf.setFont("Helvetica", 8)
    pdf.drawRightString(
        width - 18 * mm,
        height - 8 * mm,
        f"{context['filter_date']} · {context['plant_scope']}",
    )
    # Footer band
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_INK))
    pdf.setFont("Helvetica", 7)
    pdf.drawString(18 * mm, 8 * mm, f"Generated {context['generated_at']} · Confidential")
    pdf.drawRightString(width - 18 * mm, 8 * mm, page_label)


def _draw_kpi_card(
    pdf: "canvas.Canvas",
    x: float,
    y: float,
    w: float,
    h: float,
    label: str,
    value: str,
    detail: str = "",
    accent: str = _PDF_BRAND_TEAL,
) -> None:
    pdf.setStrokeColor(colors.HexColor(_PDF_BRAND_LINE))
    pdf.setFillColor(colors.white)
    pdf.roundRect(x, y, w, h, 4 * mm, stroke=1, fill=1)
    # accent stripe on the left
    pdf.setFillColor(colors.HexColor(accent))
    pdf.rect(x, y + 2 * mm, 1.4 * mm, h - 4 * mm, stroke=0, fill=1)
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_SLATE))
    pdf.setFont("Helvetica-Bold", 7)
    pdf.drawString(x + 6 * mm, y + h - 6 * mm, label.upper())
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_INK))
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(x + 6 * mm, y + h - 13 * mm, value)
    if detail:
        pdf.setFillColor(colors.HexColor(_PDF_BRAND_SLATE))
        pdf.setFont("Helvetica", 7.5)
        pdf.drawString(x + 6 * mm, y + 3.5 * mm, detail[:60])


def _draw_section_heading(pdf: "canvas.Canvas", x: float, y: float, title: str, subtitle: str = "") -> None:
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_TEAL_DEEP))
    pdf.setFont("Helvetica-Bold", 13)
    pdf.drawString(x, y, title)
    if subtitle:
        pdf.setFillColor(colors.HexColor(_PDF_BRAND_SLATE))
        pdf.setFont("Helvetica", 8.5)
        pdf.drawString(x, y - 4 * mm, subtitle)


def _draw_waterfall(
    pdf: "canvas.Canvas",
    x: float,
    y: float,
    w: float,
    h: float,
    bars: list[dict[str, Any]],
) -> None:
    """Render a waterfall (anchor + positive + negative bars) inside (x,y,w,h).

    Includes dashed connector lines between bar tops so the running total is
    obvious even when delta bars are tiny relative to the anchor.
    """
    if not bars:
        return
    # Compute running totals to map start/end of each bar.
    running = 0.0
    framed: list[dict[str, Any]] = []
    for b in bars:
        if b.get("total"):
            framed.append({**b, "start": 0.0, "end": _safe_num(b["value"]), "running": _safe_num(b["value"])})
            running = _safe_num(b["value"])
        else:
            start = running
            end = running + _safe_num(b["value"])
            framed.append({**b, "start": start, "end": end, "running": end})
            running = end
    max_val = max([abs(d["start"]) for d in framed] + [abs(d["end"]) for d in framed] + [1.0])
    bar_count = len(framed)
    pad = 4 * mm
    inner_w = w - 2 * pad
    inner_h = h - 18 * mm  # leave room for label + axis tick
    slot_w = inner_w / bar_count
    bar_w = max(10 * mm, slot_w * 0.62)
    base_y = y + 10 * mm

    # baseline
    pdf.setStrokeColor(colors.HexColor(_PDF_BRAND_LINE))
    pdf.setDash(2, 2)
    pdf.line(x + pad, base_y, x + pad + inner_w, base_y)
    pdf.setDash()

    # y-axis ticks (3 horizontal guides at 25/50/75%)
    pdf.setStrokeColor(colors.HexColor("#e2e8f0"))
    pdf.setDash(1, 3)
    for pct in (0.25, 0.5, 0.75, 1.0):
        ly = base_y + pct * inner_h
        pdf.line(x + pad, ly, x + pad + inner_w, ly)
        pdf.setFillColor(colors.HexColor(_PDF_BRAND_SLATE))
        pdf.setFont("Helvetica", 6.5)
        pdf.drawString(x + 1 * mm, ly - 1.5, f"{(pct * max_val):,.0f}")
    pdf.setDash()

    # Connector lines linking consecutive bar tops (drawn first so bars cover them at their own slot)
    for idx in range(len(framed) - 1):
        a = framed[idx]
        b = framed[idx + 1]
        # connector at the end-of-bar height for `a`, leading to start-of-bar for `b`
        ay = base_y + (a["running"] / max_val) * inner_h
        # x coords for connector
        a_cx = x + pad + idx * slot_w + (slot_w - bar_w) / 2
        b_cx = x + pad + (idx + 1) * slot_w + (slot_w - bar_w) / 2
        pdf.setStrokeColor(colors.HexColor(_PDF_BRAND_LINE))
        pdf.setDash(2, 2)
        pdf.line(a_cx + bar_w, ay, b_cx, ay)
        pdf.setDash()

    for idx, d in enumerate(framed):
        cx = x + pad + idx * slot_w + (slot_w - bar_w) / 2
        top = base_y + (max(d["start"], d["end"]) / max_val) * inner_h
        bot = base_y + (min(d["start"], d["end"]) / max_val) * inner_h
        # Give tiny delta bars a visible minimum height so the chart reads as bars, not stripes
        bar_h = max(3.5 * mm if not d.get("total") else 4.0, top - bot)
        # Re-center the visible bar around the actual top so the running-total story stays correct
        if not d.get("total") and bar_h > (top - bot):
            mid = (top + bot) / 2
            bot = mid - bar_h / 2
            top = bot + bar_h
        tone = d.get("tone")
        if tone == "anchor" or d.get("total"):
            color = _PDF_BRAND_INK
        elif tone == "positive":
            color = _PDF_BRAND_EMERALD
        elif tone == "negative":
            color = _PDF_BRAND_ROSE
        else:
            color = _PDF_BRAND_SLATE
        pdf.setFillColor(colors.HexColor(color))
        pdf.roundRect(cx, bot, bar_w, bar_h, 1.2 * mm, stroke=0, fill=1)
        # bar delta label above each bar
        pdf.setFillColor(colors.HexColor(_PDF_BRAND_INK))
        pdf.setFont("Helvetica-Bold", 7.5)
        val_label = f"{d['value']:+,.0f}" if not d.get("total") else f"{d['value']:,.0f}"
        pdf.drawCentredString(cx + bar_w / 2, top + 2 * mm, f"{val_label} kg")
        # running total under each delta (anchors already show their own value)
        if not d.get("total"):
            pdf.setFillColor(colors.HexColor(_PDF_BRAND_SLATE))
            pdf.setFont("Helvetica", 6.5)
            pdf.drawCentredString(cx + bar_w / 2, bot - 3 * mm, f"→ {d['running']:,.0f}")
        # x-axis label
        pdf.setFillColor(colors.HexColor(_PDF_BRAND_SLATE))
        pdf.setFont("Helvetica", 7.5)
        pdf.drawCentredString(cx + bar_w / 2, y + 3.5 * mm, str(d["label"])[:14])


def _draw_throughput_trend(
    pdf: "canvas.Canvas",
    x: float,
    y: float,
    w: float,
    h: float,
    bars: list[dict[str, Any]],
) -> None:
    """Stacked-mini trend used on page 2 — dispatch-emphasis."""
    if not bars:
        return
    pad = 4 * mm
    inner_w = w - 2 * pad
    inner_h = h - 12 * mm
    slot_w = inner_w / max(len(bars), 1)
    bar_w = max(2 * mm, slot_w * 0.18)
    base_y = y + 8 * mm
    # grid line
    pdf.setStrokeColor(colors.HexColor(_PDF_BRAND_LINE))
    pdf.setDash(2, 2)
    pdf.line(x + pad, base_y, x + pad + inner_w, base_y)
    pdf.setDash()
    for idx, row in enumerate(bars):
        bx = x + pad + idx * slot_w + 2
        for offset, key, color in (
            (0, "winder_height", _PDF_BRAND_TEAL),
            (bar_w + 0.6 * mm, "process_height", _PDF_BRAND_AMBER),
            (2 * (bar_w + 0.6 * mm), "dispatch_height", _PDF_BRAND_EMERALD),
        ):
            scale = inner_h / 200.0
            bar_h = max(1.5 * mm, _safe_num(row.get(key)) * scale)
            pdf.setFillColor(colors.HexColor(color))
            pdf.roundRect(bx + offset, base_y, bar_w, bar_h, 0.8 * mm, stroke=0, fill=1)
        pdf.setFillColor(colors.HexColor(_PDF_BRAND_SLATE))
        pdf.setFont("Helvetica", 6.5)
        pdf.drawString(bx, y + 2.5 * mm, str(row.get("label") or "-")[:8])
    # legend
    legend_y = y + h - 4 * mm
    for offset, label, color in (
        (0, "Winder", _PDF_BRAND_TEAL),
        (18 * mm, "Process", _PDF_BRAND_AMBER),
        (36 * mm, "Dispatch", _PDF_BRAND_EMERALD),
    ):
        pdf.setFillColor(colors.HexColor(color))
        pdf.rect(x + pad + offset, legend_y, 2 * mm, 2 * mm, stroke=0, fill=1)
        pdf.setFillColor(colors.HexColor(_PDF_BRAND_SLATE))
        pdf.setFont("Helvetica", 7)
        pdf.drawString(x + pad + offset + 3 * mm, legend_y + 0.3 * mm, label)


def render_owner_pack_pdf(report: dict[str, Any], *, report_date: date | None = None) -> bytes:
    """Owner-pack PDF — premium board-ready layout (3 pages, A4 portrait)."""
    context = build_owner_pack_context(report, report_date=report_date)
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    # ───────────────────── Page 1 — Cover + hero KPIs ─────────────────────
    # Full-bleed gradient panel as the hero. ReportLab doesn't do gradients
    # natively, so we approximate with two stacked rounded rects.
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_BG))
    pdf.rect(0, 0, width, height, stroke=0, fill=1)

    hero_top = height - 16 * mm
    hero_h = 88 * mm
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_TEAL_DEEP))
    pdf.roundRect(14 * mm, hero_top - hero_h, width - 28 * mm, hero_h, 6 * mm, stroke=0, fill=1)
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_TEAL))
    pdf.roundRect(14 * mm, hero_top - hero_h + 3 * mm, width - 28 * mm, hero_h - 3 * mm, 6 * mm, stroke=0, fill=1)

    pdf.setFillColor(colors.white)
    pdf.setFont("Helvetica", 9)
    pdf.drawString(22 * mm, hero_top - 12 * mm, "HARI OM PAPER · OWNER DAILY PACK")
    pdf.setFont("Helvetica-Bold", 24)
    pdf.drawString(22 * mm, hero_top - 22 * mm, context["title"])
    pdf.setFont("Helvetica", 10)
    pdf.drawString(22 * mm, hero_top - 30 * mm, context["subtitle"][:96])
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawString(22 * mm, hero_top - 42 * mm, f"PLANT: {context['plant_scope']}")
    pdf.drawString(85 * mm, hero_top - 42 * mm, f"WINDOW: {context['filter_date']}")
    pdf.drawString(22 * mm, hero_top - 48 * mm, f"GENERATED: {context['generated_at']}")
    pdf.drawString(85 * mm, hero_top - 48 * mm,
                   f"DATA RANGE: {context['available_range'].get('start_date') or '-'} → {context['available_range'].get('end_date') or '-'}")

    # 4 hero KPI cards floating over the hero base
    card_w = (width - 36 * mm) / 4
    card_y = hero_top - hero_h - 12 * mm
    accents = [_PDF_BRAND_TEAL, _PDF_BRAND_EMERALD, _PDF_BRAND_AMBER, _PDF_BRAND_TEAL_DEEP]
    for idx, metric in enumerate(context["metrics"][:4]):
        _draw_kpi_card(
            pdf,
            16 * mm + idx * (card_w + 1.5 * mm),
            card_y - 24 * mm,
            card_w,
            24 * mm,
            metric["label"],
            metric["value"],
            metric["detail"],
            accent=accents[idx % len(accents)],
        )

    # Exception KPI strip (6 secondary KPIs in a 3×2 grid)
    _draw_section_heading(pdf, 18 * mm, card_y - 36 * mm,
                          "Exception signals", "Six things to glance at before standup.")
    grid_y = card_y - 44 * mm
    small_w = (width - 36 * mm) / 3
    accents_secondary = [_PDF_BRAND_ROSE, _PDF_BRAND_AMBER, _PDF_BRAND_TEAL,
                         _PDF_BRAND_SLATE, _PDF_BRAND_EMERALD, _PDF_BRAND_TEAL_DEEP]
    for idx, metric in enumerate(context["exception_kpis"][:6]):
        row = idx // 3
        col = idx % 3
        _draw_kpi_card(
            pdf,
            16 * mm + col * (small_w + 1.5 * mm),
            grid_y - row * 26 * mm - 22 * mm,
            small_w,
            22 * mm,
            metric["label"],
            metric["value"],
            metric["detail"],
            accent=accents_secondary[idx % len(accents_secondary)],
        )

    _draw_page_chrome(pdf, width, height, "Page 1 of 3 · Cover", context)
    pdf.showPage()

    # ───────────────────── Page 2 — Variance + Throughput ─────────────────
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_BG))
    pdf.rect(0, 0, width, height, stroke=0, fill=1)

    _draw_section_heading(pdf, 18 * mm, height - 22 * mm,
                          "Variance bridge (kg)", "Theoretical → adjustments → actual. The kg story for the period.")
    waterfall_bars = _waterfall_bars(report)
    _draw_waterfall(pdf, 16 * mm, height - 110 * mm, width - 32 * mm, 80 * mm, waterfall_bars)

    _draw_section_heading(pdf, 18 * mm, height - 122 * mm,
                          "Production throughput", "Winder / Process / Dispatch across recent buckets.")
    _draw_throughput_trend(pdf, 16 * mm, height - 180 * mm, width - 32 * mm, 50 * mm, context["throughput"])

    # OTIF box at bottom
    otif = _safe_num(context["sections"]["summary"]["otif_percent"])
    otif_ok = otif >= 92
    pdf.setStrokeColor(colors.HexColor(_PDF_BRAND_LINE))
    pdf.setFillColor(colors.HexColor("#ecfdf5" if otif_ok else "#fef2f2"))
    pdf.roundRect(16 * mm, 35 * mm, width - 32 * mm, 26 * mm, 4 * mm, stroke=1, fill=1)
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_EMERALD if otif_ok else _PDF_BRAND_ROSE))
    pdf.setFont("Helvetica-Bold", 11)
    pdf.drawString(22 * mm, 52 * mm, f"OTIF · {otif:.1f}% (target 92%)")
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_INK))
    pdf.setFont("Helvetica", 8.5)
    pdf.drawString(22 * mm, 46 * mm,
                   "On-time, in-full for closed orders in this window." if otif_ok else
                   "OTIF below the 92% target — see /reports/sales for the delayed-order drill.")

    _draw_page_chrome(pdf, width, height, "Page 2 of 3 · Variance & Throughput", context)
    pdf.showPage()

    # ───────────────────── Page 3 — Tables + Notes ─────────────────
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_BG))
    pdf.rect(0, 0, width, height, stroke=0, fill=1)

    _draw_section_heading(pdf, 18 * mm, height - 22 * mm,
                          "Delayed orders", "Open demand slipping beyond committed dates.")
    pdf.setFont("Helvetica-Bold", 8)
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_SLATE))
    row_y = height - 32 * mm
    pdf.drawString(18 * mm, row_y, "ORDER")
    pdf.drawString(50 * mm, row_y, "CUSTOMER")
    pdf.drawString(130 * mm, row_y, "DUE")
    pdf.drawString(165 * mm, row_y, "STATUS")
    pdf.setStrokeColor(colors.HexColor(_PDF_BRAND_LINE))
    pdf.line(18 * mm, row_y - 1 * mm, width - 18 * mm, row_y - 1 * mm)
    pdf.setFont("Helvetica", 8.5)
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_INK))
    delayed = context["delayed_orders"][:10]
    if not delayed:
        pdf.setFillColor(colors.HexColor(_PDF_BRAND_SLATE))
        pdf.drawString(18 * mm, row_y - 7 * mm, "No delayed orders in this window.")
        pdf.setFillColor(colors.HexColor(_PDF_BRAND_INK))
    for idx, row in enumerate(delayed):
        ry = row_y - 6 * mm - idx * 5 * mm
        pdf.drawString(18 * mm, ry, str(row.get("order_no") or "-")[:12])
        pdf.drawString(50 * mm, ry, str(row.get("customer_name") or "-")[:36])
        pdf.drawString(130 * mm, ry, str(row.get("due_date") or "-")[:10])
        pdf.drawString(165 * mm, ry, str(row.get("status") or "-")[:14])

    _draw_section_heading(pdf, 18 * mm, height - 130 * mm,
                          "Low-stock risk", "Items under immediate availability pressure.")
    pdf.setFont("Helvetica-Bold", 8)
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_SLATE))
    row_y2 = height - 140 * mm
    pdf.drawString(18 * mm, row_y2, "ITEM CODE")
    pdf.drawString(60 * mm, row_y2, "NAME")
    pdf.drawString(150 * mm, row_y2, "AVAILABLE")
    pdf.line(18 * mm, row_y2 - 1 * mm, width - 18 * mm, row_y2 - 1 * mm)
    pdf.setFont("Helvetica", 8.5)
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_INK))
    low_stock = context["low_stock"][:10]
    if not low_stock:
        pdf.setFillColor(colors.HexColor(_PDF_BRAND_SLATE))
        pdf.drawString(18 * mm, row_y2 - 7 * mm, "No low-stock items in this window.")
        pdf.setFillColor(colors.HexColor(_PDF_BRAND_INK))
    for idx, row in enumerate(low_stock):
        ry = row_y2 - 6 * mm - idx * 5 * mm
        pdf.drawString(18 * mm, ry, str(row.get("item_code") or "-")[:18])
        pdf.drawString(60 * mm, ry, str(row.get("name") or "-")[:46])
        pdf.drawRightString(178 * mm, ry, _metric(row.get("available_qty"), digits=0))

    # Notes block at the bottom
    _draw_section_heading(pdf, 18 * mm, 65 * mm,
                          "Period framing", "Sources, scope and disclaimers.")
    pdf.setFont("Helvetica", 8.5)
    pdf.setFillColor(colors.HexColor(_PDF_BRAND_INK))
    notes = [
        f"Available range: {context['available_range'].get('start_date') or '-'} → {context['available_range'].get('end_date') or '-'}",
        f"Plant scope: {context['plant_scope']}",
        f"OTIF: {_metric(context['sections']['summary']['otif_percent'], '%', 1)} · Target 92%",
        f"Blocked jobs: {context['sections']['summary']['blocked_jobs']} · QC holds: {context['sections']['summary']['active_qc_holds']} · Low stock: {context['sections']['summary']['low_stock_items']}",
        "Source: analytics-service /reports/owner-pack · Reconciliation: production-service.",
    ]
    ny = 56 * mm
    for note in notes:
        pdf.drawString(18 * mm, ny, note)
        ny -= 5 * mm

    _draw_page_chrome(pdf, width, height, "Page 3 of 3 · Detail tables", context)
    pdf.save()
    return buffer.getvalue()


def owner_report_filename(report_date: date) -> str:
    return f"hariom-owner-pack-{report_date.isoformat()}.pdf"


def persist_owner_pack_pdf(pdf_bytes: bytes, report_date: date) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    destination = OUTPUT_DIR / owner_report_filename(report_date)
    destination.write_bytes(pdf_bytes)
    return destination


def get_owner_recipients() -> list[dict[str, str]]:
    response = requests.get(
        f"{AUTH_SERVICE_URL}/users/owners/active",
        headers={"x-internal-token": INTERNAL_EVENT_TOKEN},
        timeout=15.0,
    )
    response.raise_for_status()
    return list((response.json() or {}).get("items") or [])


def send_owner_pack_email(*, report_date: date, pdf_bytes: bytes, html: str, recipients: list[str]) -> None:
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_username = os.getenv("SMTP_USERNAME")
    smtp_password = os.getenv("SMTP_PASSWORD")
    smtp_from = os.getenv("SMTP_FROM", smtp_username or "reports@hariom.local")
    smtp_use_tls = os.getenv("SMTP_USE_TLS", "true").lower() != "false"
    if not recipients:
        raise RuntimeError("At least one owner-pack recipient is required")
    if not smtp_host:
        raise RuntimeError("SMTP_HOST is required for owner-pack delivery")

    message = EmailMessage()
    message["Subject"] = f"Hari Om Owner Close Pack · {report_date.isoformat()}"
    message["From"] = smtp_from
    message["To"] = ", ".join(recipients)
    message.set_content(
        "The daily owner close pack is attached as a PDF. Open the HTML part in a rich mail client for the styled preview."
    )
    message.add_alternative(html, subtype="html")
    message.add_attachment(
        pdf_bytes,
        maintype="application",
        subtype="pdf",
        filename=owner_report_filename(report_date),
    )

    with smtplib.SMTP(smtp_host, smtp_port, timeout=30) as smtp:
        if smtp_use_tls:
            smtp.starttls()
        if smtp_username:
            smtp.login(smtp_username, smtp_password or "")
        smtp.send_message(message)


def emit_delivery_notification(*, success: bool, report_date: date, detail: str) -> None:
    payload = {
        "event_type": "REPORT_DAILY_SENT" if success else "REPORT_DAILY_FAILED",
        "title": f"Owner daily pack {'sent' if success else 'failed'}",
        "message": detail,
        "href": "/reports/owner",
        "recipient_roles": ["Owner"] if success else ["Owner", "Admin"],
        "payload": {"report_date": report_date.isoformat()},
    }
    requests.post(
        f"{AUTH_SERVICE_URL}/notifications/events",
        headers={
            "x-internal-token": INTERNAL_EVENT_TOKEN,
            "content-type": "application/json",
        },
        json=payload,
        timeout=15.0,
    )
