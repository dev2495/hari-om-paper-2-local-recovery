from types import SimpleNamespace

import pytest

from src import scheduler


@pytest.mark.parametrize(
    ("runner", "expected_id"),
    [
        (scheduler._run_owner_pack, "owner_pack_daily"),
        (scheduler._run_exceptions_check, "exceptions_check_hourly"),
    ],
)
def test_scheduler_records_queue_id_without_overwriting_scheduler_key(monkeypatch, runner, expected_id):
    recorded = {}

    monkeypatch.setattr(
        scheduler,
        "enqueue_job",
        lambda *args, **kwargs: (SimpleNamespace(id="queue-123"), True),
    )
    monkeypatch.setattr(
        scheduler,
        "_record",
        lambda scheduler_id, **kwargs: recorded.update({"scheduler_id": scheduler_id, **kwargs}),
    )

    runner()

    assert recorded["scheduler_id"] == expected_id
    assert recorded["queue_job_id"] == "queue-123"
    assert recorded["status"] == "QUEUED"
    assert recorded["last_error"] is None
