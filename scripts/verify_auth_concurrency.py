"""Exercise authenticated HTTP concurrency against an isolated local BFF.

Read credentials from an existing private browser fixture, never command-line flags.
This probe creates successful sign-in audit events, but changes no business records.
"""
from __future__ import annotations

import argparse
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
import http.cookiejar
import json
from pathlib import Path
import time
import urllib.error
import urllib.parse
import urllib.request


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', default='http://127.0.0.1:25000')
    parser.add_argument('--fixture', type=Path, required=True)
    parser.add_argument('--workers', type=int, default=12)
    parser.add_argument('--iterations', type=int, default=160)
    args = parser.parse_args()
    if urllib.parse.urlparse(args.base_url).hostname not in {'localhost', '127.0.0.1', '::1'}:
        parser.error('This acceptance probe is restricted to an isolated localhost BFF.')
    if not 1 <= args.workers <= 32 or not 1 <= args.iterations <= 2000:
        parser.error('Use 1–32 workers and 1–2000 iterations.')
    fixture = json.loads(args.fixture.read_text())
    user = fixture['users']['admin']
    plant = fixture['plants']['plant_a']['id']
    paths = ['/api/auth/me', '/api/auth/plants', '/api/auth/roles', '/api/auth/notifications']
    started = time.monotonic()

    def worker(_: int) -> tuple[Counter, list[float]]:
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        counts: Counter = Counter()
        durations = []

        def call(path: str, data: dict | None = None) -> None:
            request = urllib.request.Request(
                args.base_url.rstrip('/') + path,
                data=json.dumps(data).encode() if data is not None else None,
                headers={'Content-Type': 'application/json', 'X-Plant-ID': plant},
                method='POST' if data is not None else 'GET',
            )
            with opener.open(request, timeout=45) as response:
                body = json.loads(response.read())
                if not isinstance(body, (dict, list)):
                    raise ValueError('Unexpected authenticated response')

        try:
            call('/api/auth/login', {'email': user['email'], 'password': user['password']})
            for i in range(args.iterations):
                request_started = time.monotonic()
                call(paths[i % len(paths)])
                durations.append((time.monotonic() - request_started) * 1000)
                counts['passed'] += 1
        except urllib.error.HTTPError as exc:
            counts[f'HTTP_{exc.code}'] += 1
        except Exception as exc:
            counts[type(exc).__name__] += 1
        return counts, durations

    counts: Counter = Counter()
    durations = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for future in as_completed(pool.submit(worker, i) for i in range(args.workers)):
            result, timings = future.result()
            counts.update(result)
            durations.extend(timings)
    durations.sort()
    expected = args.workers * args.iterations
    passed = counts['passed'] == expected and sum(counts.values()) == expected
    result = {
        'status': 'PASS' if passed else 'FAIL',
        'expected_authenticated_requests': expected,
        'counts': dict(counts),
        'elapsed_seconds': round(time.monotonic() - started, 2),
        'latency_ms': {
            'p50': round(durations[len(durations) // 2], 2),
            'p95': round(durations[min(len(durations) - 1, int(len(durations) * .95))], 2),
            'max': round(max(durations), 2),
        } if durations else None,
    }
    print(json.dumps(result, indent=2))
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
