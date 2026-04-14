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
        "plant_scope": "All Visible Plants" if filters.get("plant_scope") == "ALL" else str(filters.get("plant_scope") or "Single Plant"),
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


def render_owner_pack_pdf(report: dict[str, Any], *, report_date: date | None = None) -> bytes:
    context = build_owner_pack_context(report, report_date=report_date)
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=A4)
    width, height = A4

    def header():
        pdf.setFillColor(colors.HexColor("#0d3f56"))
        pdf.roundRect(18 * mm, height - 72 * mm, width - 36 * mm, 54 * mm, 10 * mm, stroke=0, fill=1)
        pdf.setFillColor(colors.white)
        pdf.setFont("Helvetica-Bold", 22)
        pdf.drawString(24 * mm, height - 32 * mm, context["title"])
        pdf.setFont("Helvetica", 10)
        pdf.drawString(24 * mm, height - 38 * mm, context["subtitle"])
        pdf.drawString(24 * mm, height - 45 * mm, f"Generated {context['generated_at']} · {context['plant_scope']} · {context['filter_date']}")

    def metric_card(x: float, y: float, w: float, h: float, label: str, value: str, detail: str):
        pdf.setFillColor(colors.white)
        pdf.setStrokeColor(colors.HexColor("#d8dee5"))
        pdf.roundRect(x, y, w, h, 8, stroke=1, fill=1)
        pdf.setFillColor(colors.HexColor("#667788"))
        pdf.setFont("Helvetica-Bold", 8)
        pdf.drawString(x + 10, y + h - 16, label.upper())
        pdf.setFillColor(colors.HexColor("#102333"))
        pdf.setFont("Helvetica-Bold", 18)
        pdf.drawString(x + 10, y + h - 36, value)
        pdf.setFillColor(colors.HexColor("#667788"))
        pdf.setFont("Helvetica", 8)
        pdf.drawString(x + 10, y + 10, detail[:48])

    def section_title(y: float, title: str, subtitle: str):
        pdf.setFillColor(colors.HexColor("#102333"))
        pdf.setFont("Helvetica-Bold", 14)
        pdf.drawString(20 * mm, y, title)
        pdf.setFillColor(colors.HexColor("#667788"))
        pdf.setFont("Helvetica", 9)
        pdf.drawString(20 * mm, y - 5 * mm, subtitle)

    header()
    card_w = (width - 48 * mm) / 4
    card_y = height - 92 * mm
    for idx, metric in enumerate(context["metrics"]):
        metric_card(20 * mm + idx * (card_w + 2 * mm), card_y, card_w, 24 * mm, metric["label"], metric["value"], metric["detail"])

    section_title(height - 128 * mm, "Exception KPI Rail", "Leadership signals that require attention now.")
    exception_y = height - 165 * mm
    small_card_w = (width - 48 * mm) / 3
    for idx, metric in enumerate(context["exception_kpis"][:6]):
        row = idx // 3
        col = idx % 3
        metric_card(20 * mm + col * (small_card_w + 2 * mm), exception_y - row * 30 * mm, small_card_w, 24 * mm, metric["label"], metric["value"], metric["detail"])

    section_title(height - 235 * mm, "Production Throughput", "Winder, process, and dispatch movement across recent buckets.")
    chart_x = 24 * mm
    chart_y = height - 275 * mm
    chart_h = 32 * mm
    chart_w = width - 48 * mm
    pdf.setStrokeColor(colors.HexColor("#d8dee5"))
    pdf.line(chart_x, chart_y, chart_x + chart_w, chart_y)
    bars = context["throughput"]
    bar_slot = chart_w / max(len(bars), 1)
    for idx, row in enumerate(bars):
        x = chart_x + idx * bar_slot + 4
        base = chart_y
        widths = max(bar_slot / 5, 5)
        for offset, key, color in (
            (0, "winder_height", "#0e6a77"),
            (widths + 2, "process_height", "#cb6d1d"),
            (2 * (widths + 2), "dispatch_height", "#1e293b"),
        ):
            pdf.setFillColor(colors.HexColor(color))
            pdf.roundRect(x + offset, base, widths, row[key] * 0.22, 2, stroke=0, fill=1)
        pdf.setFillColor(colors.HexColor("#667788"))
        pdf.setFont("Helvetica", 7)
        pdf.drawString(x, base - 10, str(row["label"])[:10])

    section_title(height - 290 * mm, "Key Tables", "Delayed orders and low-stock items visible in the current window.")
    table_y = height - 305 * mm
    pdf.setFont("Helvetica-Bold", 9)
    pdf.drawString(20 * mm, table_y, "Delayed Orders")
    pdf.drawString(110 * mm, table_y, "Low Stock Risk")
    pdf.setFont("Helvetica", 8)
    for idx, row in enumerate(context["delayed_orders"][:7]):
        pdf.drawString(20 * mm, table_y - 8 - idx * 10, f"{row.get('order_no') or '-'} · {row.get('customer_name') or '-'} · {row.get('status') or '-'}")
    for idx, row in enumerate(context["low_stock"][:7]):
        pdf.drawString(110 * mm, table_y - 8 - idx * 10, f"{row.get('item_code') or '-'} · {row.get('name') or '-'} · {row.get('available_qty') or 0}")

    pdf.showPage()
    header()
    section_title(height - 30 * mm, "Report Notes", "Availability metadata and board-pack framing.")
    pdf.setFont("Helvetica", 10)
    pdf.setFillColor(colors.HexColor("#102333"))
    notes = [
        f"Available range: {context['available_range'].get('start_date') or '-'} to {context['available_range'].get('end_date') or '-'}",
        f"Blocked jobs: {context['sections']['summary']['blocked_jobs']}",
        f"QC holds: {context['sections']['summary']['active_qc_holds']}",
        f"Low stock items: {context['sections']['summary']['low_stock_items']}",
        f"OTIF: {_metric(context['sections']['summary']['otif_percent'], '%', 1)}",
    ]
    y = height - 42 * mm
    for note in notes:
        pdf.drawString(20 * mm, y, note)
        y -= 8 * mm

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
