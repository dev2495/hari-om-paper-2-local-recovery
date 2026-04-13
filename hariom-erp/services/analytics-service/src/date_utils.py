from datetime import date, datetime
from fastapi import HTTPException

def parse_iso_date(value: str) -> date:
    return datetime.fromisoformat(value).date()

def parse_date_range(start_date: str, end_date: str) -> tuple[date, date]:
    start = parse_iso_date(start_date)
    end = parse_iso_date(end_date)
    if end < start:
        raise HTTPException(status_code=400, detail="end_date must be greater than or equal to start_date")
    return start, end
