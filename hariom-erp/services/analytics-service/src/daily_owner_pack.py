from __future__ import annotations

from datetime import date

from src.report_exports import emit_delivery_notification, get_owner_recipients, persist_owner_pack_pdf, render_owner_pack_html, render_owner_pack_pdf, send_owner_pack_email
from src.routers.reports import build_daily_owner_pack


def main() -> None:
    report_date = date.today()
    try:
        report = build_daily_owner_pack(report_date=report_date)
        html = render_owner_pack_html(report, report_date=report_date)
        pdf_bytes = render_owner_pack_pdf(report, report_date=report_date)
        recipients = [row["email"] for row in get_owner_recipients() if row.get("email")]
        if not recipients:
            raise RuntimeError("No active Owner recipients configured")
        persist_owner_pack_pdf(pdf_bytes, report_date)
        send_owner_pack_email(report_date=report_date, pdf_bytes=pdf_bytes, html=html, recipients=recipients)
        emit_delivery_notification(
            success=True,
            report_date=report_date,
            detail=f"Daily owner close pack sent to {len(recipients)} owner recipients.",
        )
    except Exception as exc:
        emit_delivery_notification(
            success=False,
            report_date=report_date,
            detail=f"Daily owner close pack failed: {exc}",
        )
        raise


if __name__ == "__main__":
    main()
