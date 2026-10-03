"""Offline guards and secret-redaction contracts; no runtime/AWS records."""
import importlib.util
import sys
from pathlib import Path

import httpx
import pytest

SPEC = importlib.util.spec_from_file_location('aws_acceptance_test', Path(__file__).parents[1] / 'verify_aws_acceptance.py')
api = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(api)
SHA = 'a' * 40


def environment(monkeypatch):
    for key, value in {'ERP_AWS_DEPLOYED_SHA': SHA, 'ERP_AWS_ACCEPTANCE': 'AUTHORIZED_TESTING_WORKFLOW',
                       'APP_ENV': 'production', 'ENVIRONMENT': 'production',
                       'SITE_HOST': 'erp.test.invalid', 'PUBLIC_APP_ORIGIN': 'https://erp.test.invalid'}.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(api.Path, 'exists', lambda path: str(path) == '/.dockerenv')
    monkeypatch.setattr(api.Path, 'is_file', lambda path: str(path) == '/app/deploy/aws-ec2/docker-compose.yml')


@pytest.mark.parametrize('change', ['sha', 'authorization', 'environment', 'container', 'ports', 'run', 'host', 'origin'])
def test_guard_refuses_wrong_release_or_execution_environment_before_client_creation(monkeypatch, capsys, change):
    environment(monkeypatch)
    run = 'AWS123'
    if change == 'sha': monkeypatch.setenv('ERP_AWS_DEPLOYED_SHA', 'b' * 40)
    elif change == 'authorization': monkeypatch.delenv('ERP_AWS_ACCEPTANCE')
    elif change == 'environment': monkeypatch.setenv('APP_ENV', 'local')
    elif change == 'container': monkeypatch.setattr(api.Path, 'exists', lambda path: False)
    elif change == 'ports': monkeypatch.setenv('PRODUCTION_PORT', '18025')
    elif change == 'host': monkeypatch.setenv('SITE_HOST', 'another.test.invalid')
    elif change == 'origin': monkeypatch.setenv('PUBLIC_APP_ORIGIN', 'http://erp.test.invalid')
    else: run = '../../escape'
    monkeypatch.setattr(api.httpx, 'Client', lambda **kw: pytest.fail('Guard must stop before any HTTP client or credentials'))
    monkeypatch.setattr(sys, 'argv', ['verify_aws_acceptance.py', '--expected-sha', SHA, '--run', run, '--expected-host', 'erp.test.invalid'])
    assert api.main() == 1
    assert capsys.readouterr().out.startswith('BLOCKED ')


def bare(client):
    obj = api.Acceptance.__new__(api.Acceptance)
    obj.client, obj.tokens, obj.account = client, {}, 'ADMIN'
    obj.plant, obj.metrics, obj.state = api.PLANTS['A'], {}, {'checks': []}
    obj.identities = {}
    obj.mark = lambda *args, **kw: None
    obj.save = lambda: None
    return obj


def test_missing_bootstrap_credentials_never_fall_back_to_demo_passwords(monkeypatch):
    monkeypatch.delenv('BOOTSTRAP_ADMIN_EMAIL', raising=False)
    monkeypatch.delenv('BOOTSTRAP_ADMIN_PASSWORD', raising=False)
    obj = bare(httpx.Client(transport=httpx.MockTransport(lambda request: pytest.fail('Missing credentials must not login'))))
    with pytest.raises(api.AcceptanceBlocked, match='credentials are not configured'): obj.login('ADMIN')


def test_login_failure_and_api_errors_cannot_emit_returned_secret_bodies(monkeypatch):
    secret = 'SECRET-MUST-NOT-BE-OUTPUT'
    monkeypatch.setenv('BOOTSTRAP_ADMIN_EMAIL', 'fake-test@example.com')
    monkeypatch.setenv('BOOTSTRAP_ADMIN_PASSWORD', secret)
    obj = bare(httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(401, json={'access_token': secret, 'password': secret}))))
    with pytest.raises(api.AcceptanceBlocked) as error: obj.login('ADMIN')
    assert secret not in str(error.value) and 'fake-test@example.com' not in str(error.value)
    obj.tokens['ADMIN'] = secret
    obj.client = httpx.Client(transport=httpx.MockTransport(lambda request: httpx.Response(500, json={'password': secret})))
    with pytest.raises(api.AcceptanceBlocked) as error: obj.request('sales', 'GET', '/sales-orders')
    assert secret not in str(error.value)


@pytest.mark.parametrize('case', ['same_identity', 'missing_owner', 'missing_scope'])
def test_identity_and_authority_preflight_blocks_before_operational_mutations(monkeypatch, case):
    for account in ('ADMIN', 'OWNER'):
        monkeypatch.setenv('BOOTSTRAP_' + account + '_EMAIL', account.lower() + '@test.invalid')
        monkeypatch.setenv('BOOTSTRAP_' + account + '_PASSWORD', 'Fake-test-only-password')
    requests = []
    def handler(request):
        requests.append(request)
        if request.url.path == '/health/ready': return httpx.Response(200, json={'ready': True})
        if request.url.path == '/auth/login':
            account = 'ADMIN' if 'admin%40' in request.content.decode() else 'OWNER'
            return httpx.Response(200, json={'access_token': account})
        assert request.url.path == '/auth/me'
        account = request.headers['Authorization'].split()[-1]
        return httpx.Response(200, json={'id': 'same' if case == 'same_identity' else account,
            'roles': [] if case == 'missing_owner' else ['Owner'],
            'allowed_plant_ids': [api.PLANTS['A']] if case == 'missing_scope' else list(api.PLANTS.values())})
    obj = bare(httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(api.AcceptanceBlocked): obj.preflight()
    assert all(request.method == 'GET' or request.url.path == '/auth/login' for request in requests)


def test_checker_always_restores_original_identity_after_error():
    obj = bare(None)
    with pytest.raises(ValueError):
        with obj.checker():
            assert obj.account == 'OWNER'
            raise ValueError('simulated operation failure')
    assert obj.account == 'ADMIN'


def test_season_resume_uses_new_epoch_identity_and_preserves_versioned_preview():
    obj = bare(None)
    obj.run = 'AWS123'; calls = []
    epoch = [2]
    def request(service, method, path, body=None, **kw):
        if path == '/season': return {'active_season': 'MONSOON'}
        if path.endswith('/preview'): return {'epoch': epoch[0], 'fingerprint': 'reviewed-' + str(epoch[0])}
        calls.append(body)
        return {'active_season': 'ROY'}
    obj.request = request
    obj.switch('ROY', 'restore')
    epoch[0] = 4
    obj.switch('ROY', 'restore')
    assert calls[0]['request_id'] != calls[1]['request_id']
    assert calls[0]['expected_version'] == 2 and calls[1]['expected_version'] == 4


def cleanup_fixture(tmp_path):
    import json
    obj = bare(None)
    obj.run, obj.sha = 'AWS123', SHA
    obj.state.update(complete=True, created_catalogue=[{'service': 'master', 'path': '/master/papers',
        'id': '00000000-0000-0000-0000-000000000011', 'plant_id': api.PLANTS['A'],
        'identity_field': 'code', 'identity_value': 'AWSSEASON_AWS123_A_PAPER', 'created_during_run': True}])
    manifest = tmp_path / 'reset.json'
    manifest.write_text(json.dumps({'status': 'COMPLETE', 'release_commit': SHA, 'reset_id': 'reset-123',
        'databases': {name: {'cleared': True, 'clear': ['operations'], 'after': {'operations': 0}} for name in ('authdb', 'masterdb', 'specdb', 'salesdb', 'productiondb', 'inventorydb', 'analyticsdb')}}))
    rows = [{'id': obj.state['created_catalogue'][0]['id'], 'code': 'AWSSEASON_AWS123_A_PAPER', 'plant_id': api.PLANTS['A'], 'active': True},
            {'id': '00000000-0000-0000-0000-000000000022', 'code': 'PREEXISTING-PAPER', 'plant_id': api.PLANTS['A'], 'active': True}]
    obj.authenticate_existing = lambda: None
    calls = []
    def request(service, method, path, body=None, **kw):
        calls.append((method, path))
        if method == 'DELETE':
            selected = next(row for row in rows if row['id'] == path.split('/')[-1]); selected['active'] = False
            return {'message': 'Deactivated'}
        return rows
    obj.request = request
    return obj, manifest, rows, calls


def test_catalogue_preview_and_apply_target_only_proven_created_ids_after_reset(tmp_path, capsys):
    obj, manifest, rows, calls = cleanup_fixture(tmp_path)
    obj.cleanup_catalogue(manifest)
    assert not any(method == 'DELETE' for method, path in calls)
    fingerprint = obj.state['catalogue_cleanup_preview']['fingerprint']
    obj.cleanup_catalogue(manifest, apply=True, fingerprint=fingerprint, confirm='DISABLE ONLY CREATED AWS ACCEPTANCE CATALOGUE')
    assert rows[0]['active'] is False and rows[1]['active'] is True
    assert [(method, path) for method, path in calls if method == 'DELETE'] == [('DELETE', '/master/papers/' + rows[0]['id'])]
    assert obj.state['catalogue_cleanup_complete'] is True


def test_catalogue_cleanup_rejects_changed_identity_before_deactivation(tmp_path):
    obj, manifest, rows, calls = cleanup_fixture(tmp_path)
    obj.cleanup_catalogue(manifest)
    rows[0]['code'] = 'RENAMED-BY-USER'
    with pytest.raises(api.AcceptanceBlocked, match='identity changed'):
        obj.cleanup_catalogue(manifest, apply=True, fingerprint=obj.state['catalogue_cleanup_preview']['fingerprint'], confirm='DISABLE ONLY CREATED AWS ACCEPTANCE CATALOGUE')
    assert not any(method == 'DELETE' for method, path in calls)


def test_catalogue_cleanup_requires_real_completed_zero_row_reset(tmp_path):
    import json
    obj, manifest, rows, calls = cleanup_fixture(tmp_path)
    reset = json.loads(manifest.read_text()); reset['databases']['productiondb']['after']['operations'] = 1
    manifest.write_text(json.dumps(reset))
    with pytest.raises(api.AcceptanceBlocked, match='zero-row'): obj.cleanup_catalogue(manifest)
    assert not calls


def public_fixture(monkeypatch, cookie=None, login_body=None, login_status=200):
    monkeypatch.setenv('BOOTSTRAP_ADMIN_EMAIL', 'maker@test.invalid')
    monkeypatch.setenv('BOOTSTRAP_ADMIN_PASSWORD', 'SECRET-PASSWORD')
    obj = bare(None); obj.public_origin = 'https://erp.test.invalid'
    obj.identities = {'ADMIN': '00000000-0000-0000-0000-000000000010'}
    calls = []
    def handler(request):
        calls.append(request)
        assert request.url.scheme == 'https' and request.url.host == 'erp.test.invalid'
        assert 'Authorization' not in request.headers
        if request.url.path == '/login': return httpx.Response(200, text='<html>Login</html>', headers={'content-type': 'text/html'})
        assert request.headers['Origin'] == obj.public_origin
        assert request.headers['Referer'] == obj.public_origin + '/login'
        assert request.headers['X-Plant-ID'] == obj.plant
        if request.url.path == '/api/auth/login':
            return httpx.Response(login_status, json=login_body if login_body is not None else {'roles': ['Owner']},
                headers={'Set-Cookie': cookie or 'token=SECRET-TOKEN; Path=/; Secure; HttpOnly; SameSite=lax; Max-Age=900'})
        assert request.url.path == '/api/auth/me'
        assert request.headers['Cookie'] == 'token=SECRET-TOKEN'
        return httpx.Response(200, json={'id': obj.identities['ADMIN'], 'roles': ['Owner'], 'allowed_plant_ids': list(api.PLANTS.values())})
    obj.public_client = httpx.Client(base_url=obj.public_origin, transport=httpx.MockTransport(handler), follow_redirects=False)
    return obj, calls


def test_public_https_login_and_me_use_only_normal_host_only_secure_cookie(monkeypatch):
    obj, calls = public_fixture(monkeypatch)
    obj.public_login()
    assert [request.url.path for request in calls] == ['/login', '/api/auth/login', '/api/auth/me']
    assert not any('Authorization' in request.headers for request in calls)
    assert not any('SECRET' in str(value) for value in obj.state.values())


@pytest.mark.parametrize('cookie', [
    'token=SECRET-TOKEN; Path=/; HttpOnly; SameSite=lax',
    'token=SECRET-TOKEN; Path=/; Secure; SameSite=lax',
    'token=SECRET-TOKEN; Path=/; Secure; HttpOnly; SameSite=none',
    'token=SECRET-TOKEN; Path=/; Secure; HttpOnly; SameSite=lax; Domain=erp.test.invalid',
])
def test_public_cookie_flags_fail_closed_without_secret_output(monkeypatch, cookie):
    obj, calls = public_fixture(monkeypatch, cookie=cookie)
    with pytest.raises(api.AcceptanceBlocked, match='cookie flags') as error: obj.public_login()
    assert 'SECRET' not in str(error.value)
    assert all(request.url.path != '/api/auth/me' for request in calls)


@pytest.mark.parametrize('case', ['bearer_in_body', 'redirect'])
def test_public_login_rejects_token_exposure_or_redirect_without_following(monkeypatch, case):
    obj, calls = public_fixture(monkeypatch, login_body={'access_token': 'SECRET-TOKEN'} if case == 'bearer_in_body' else {},
        login_status=302 if case == 'redirect' else 200)
    with pytest.raises(api.AcceptanceBlocked) as error: obj.public_login()
    assert 'SECRET' not in str(error.value)
    assert len(calls) == 2


def qc_fixture(monkeypatch, draft, published=None):
    obj = bare(None); obj.run = 'AWS123'; obj.authenticate_existing = lambda: None; obj.public_login = lambda: None
    calls = []; saves = []
    obj.save = lambda: saves.append(dict(obj.state))
    def request(service, method, path, body=None, **kw):
        calls.append((method, path))
        if path == '/season': return {'active_season': 'ROY'}
        if path.startswith('/qc-rules?'): return {'published': published, 'draft': draft}
        assert path.startswith('/qc-rules/draft/publish?')
        assert saves[0]['original_season'] == 'ROY'
        return {'published': draft}
    obj.request = request
    return obj, calls


def initial_seed(monkeypatch):
    original = api.importlib.util.spec_from_file_location
    path = Path(__file__).parents[3] / 'hariom-erp/shared/season_quality.py'
    spec = original('offline_quality', path); quality = api.importlib.util.module_from_spec(spec); spec.loader.exec_module(quality)
    monkeypatch.setattr(api.importlib.util, 'spec_from_file_location',
        lambda name, location: original(name, path if location == '/app/hariom-erp/shared/season_quality.py' else location))
    return {'version': 1, 'row_version': 1, 'rules': quality.initial_rules(), 'fingerprint': quality.fingerprint(quality.initial_rules()),
        'change_note': 'Client rules 2026-10-03; process ±0.2 mm and paired oven samples confirmed'}


def test_unpublished_qc_requires_explicit_review_before_any_publication(monkeypatch):
    monkeypatch.delenv('ERP_AWS_PUBLISH_CLIENT_SEED', raising=False)
    obj, calls = qc_fixture(monkeypatch, {'rules': 'not reviewed'})
    with pytest.raises(api.AcceptanceBlocked, match='Publish reviewed'): obj.preflight()
    assert all(method == 'GET' for method, path in calls)
    assert obj.state['original_season'] == 'ROY'


@pytest.mark.parametrize('change', ['rules', 'version', 'row_version', 'change_note', 'fingerprint'])
def test_even_explicit_seed_review_never_publishes_modified_preexisting_draft(monkeypatch, change):
    monkeypatch.setenv('ERP_AWS_PUBLISH_CLIENT_SEED', 'REVIEWED_CLIENT_RULES_2026_10_03')
    draft = initial_seed(monkeypatch); draft[change] = [] if change == 'rules' else 2 if change.endswith('version') else 'modified'
    obj, calls = qc_fixture(monkeypatch, draft)
    with pytest.raises(api.AcceptanceBlocked, match='exact reviewed'): obj.preflight()
    assert all(method == 'GET' for method, path in calls)


def test_reviewed_exact_initial_seed_can_publish_both_without_rewriting_rules(monkeypatch):
    monkeypatch.setenv('ERP_AWS_PUBLISH_CLIENT_SEED', 'REVIEWED_CLIENT_RULES_2026_10_03')
    obj, calls = qc_fixture(monkeypatch, initial_seed(monkeypatch))
    obj.preflight()
    assert [path for method, path in calls if method == 'POST'] == ['/qc-rules/draft/publish?season=ROY', '/qc-rules/draft/publish?season=MONSOON']


def test_existing_published_qc_is_preserved_even_with_an_unreviewed_draft(monkeypatch):
    monkeypatch.delenv('ERP_AWS_PUBLISH_CLIENT_SEED', raising=False)
    obj, calls = qc_fixture(monkeypatch, {'rules': 'unreviewed'}, published={'id': 'existing'})
    obj.preflight()
    assert all(method == 'GET' for method, path in calls)


def test_resumed_preflight_failure_still_restores_durable_original_season():
    obj = bare(None); obj.state['original_season'] = 'ROY'; obj.tokens['ADMIN'] = 'secret'
    obj.preflight = lambda: (_ for _ in ()).throw(api.AcceptanceBlocked('Preflight failure'))
    calls = []; obj.switch = lambda season, label: calls.append(season)
    with pytest.raises(api.AcceptanceBlocked, match='Preflight failure'): obj.run_all()
    assert calls == ['ROY'] and obj.state['season_restoration_required'] is False
    assert not obj.state.get('complete')


def test_restore_failure_leaves_durable_gate_and_preserves_first_failure(capsys):
    obj = bare(None); obj.state['original_season'] = 'ROY'; obj.tokens['ADMIN'] = 'secret'
    obj.preflight = lambda: (_ for _ in ()).throw(api.AcceptanceBlocked('Preflight failure'))
    obj.switch = lambda *args: (_ for _ in ()).throw(RuntimeError('SECRET-RESTORE-BODY'))
    with pytest.raises(api.AcceptanceBlocked, match='Preflight failure'): obj.run_all()
    assert obj.state['season_restoration_required'] is True and 'SECRET' not in capsys.readouterr().out


def test_lost_catalogue_create_response_is_reported_and_never_blindly_adopted():
    obj = bare(None); obj.run = 'AWS123'; rows = []; calls = []
    body = {'code': 'AWSSEASON_AWS123_A_PAPER'}
    def request(service, method, path, submitted=None, **kw):
        calls.append(method)
        if method == 'GET': return rows
        assert obj.state['catalogue_creation_intents']
        rows.append({'id': '00000000-0000-0000-0000-000000000011', **body, 'plant_id': obj.plant})
        raise httpx.ReadError('SECRET-LOST-RESPONSE')
    obj.request = request
    with pytest.raises(httpx.ReadError): obj.master('/master/papers/', 'code', body)
    with pytest.raises(api.AcceptanceBlocked, match='Unconfirmed catalogue creation UUID'): obj.master('/master/papers/', 'code', body)
    assert calls == ['GET', 'POST', 'GET'] and not obj.state.get('created_catalogue')
    assert next(iter(obj.state['catalogue_creation_intents'].values()))['unconfirmed_id'] == rows[0]['id']


def test_reused_inventory_item_is_never_written_or_taken_into_cleanup():
    obj = bare(None); obj.run = 'AWS123'; calls = []
    def request(service, method, path, body=None, **kw):
        calls.append(method)
        return [{'id': '00000000-0000-0000-0000-000000000011', 'item_code': 'AWSSEASON_AWS123_A_PAPER'}]
    obj.request = request
    with pytest.raises(api.AcceptanceBlocked, match='Reused inventory'): obj.inventory_item('AWSSEASON_AWS123_A_PAPER', {'item_code': 'AWSSEASON_AWS123_A_PAPER'})
    assert calls == ['GET'] and not obj.state.get('created_catalogue')


def test_material_issue_lost_response_recovers_only_one_new_exact_row():
    from datetime import date
    obj = bare(None); obj.business_date = date(2026, 10, 3)
    state = {'coil_id': 'coil', 'machine_WINDER': {'id': 'machine'}, 'customer': {'id': 'customer'}, 'order_id': 'order',
        'material_issues': {'previous': 'old'}}
    old = {'id': 'old'}; rows = [old]; calls = []
    def request(service, method, path, body=None, **kw):
        calls.append(method)
        if method == 'GET': return list(rows)
        assert state['material_issue_intents']['job']['baseline_ids'] == ['old']
        rows.append({'id': 'new', 'plant_id': obj.plant, **body})
        raise httpx.ReadError('lost response')
    obj.request = request
    with pytest.raises(httpx.ReadError): obj.material_issue(state, 'job')
    assert obj.material_issue(state, 'job') == 'new'
    assert calls == ['GET', 'POST', 'GET'] and state['material_issues'] == {'previous': 'old', 'job': 'new'}


def test_material_issue_ambiguous_pending_creation_never_reposts():
    from datetime import date
    obj = bare(None); obj.business_date = date(2026, 10, 3)
    state = {'coil_id': 'coil', 'machine_WINDER': {'id': 'machine'}, 'customer': {'id': 'customer'}, 'order_id': 'order',
        'material_issue_intents': {'job': {'baseline_ids': []}}}
    obj.request = lambda service, method, *args, **kw: [] if method == 'GET' else pytest.fail('Never repost ambiguous issue')
    with pytest.raises(api.AcceptanceBlocked, match='ambiguous'): obj.material_issue(state, 'job')


def test_floor_total_payload_uses_strict_integer_bamboo_and_piece_quantities():
    from datetime import date
    obj = bare(None); obj.run = 'AWS123'; obj.business_date = date(2026, 10, 3)
    state = {'target_weight': 35, 'operator': {'id': 'operator'}, 'supervisor': {'id': 'supervisor'}, 'fg_item_id': 'fg',
        'material_issues': {'job': 'issue'}, 'material_consumption_closed': ['job'],
        **{'machine_' + name: {'id': name} for name in ('WINDER', 'OVEN', 'PROCESS', 'PACKING')}}
    stages = {name: {'stage': name, 'status': 'RUNNING', 'produced_total': 0, 'row_version': 1} for name in ('WINDER', 'OVEN', 'PROCESS', 'PACKING')}
    stages['QC'] = {'stage': 'QC', 'status': 'COMPLETED'}
    obj.stage = lambda job, stage: stages[stage]
    obj.material_issue = lambda *args: 'issue'; entries = []
    def request(service, method, path, body=None, **kw):
        if path == '/job-cards/job': return {'spec_snapshot': {'pcs_per_bamboo': 10, 'qc_profile': {'refs': {'WINDING_LENGTH': 1560}}},
            'material_plan_snapshot': {}, 'packing_record': {'snapshot': {'inventory_batch_id': 'batch', 'fg_accepted_qty': 50}}}
        if path.endswith('/entries'): entries.append(body)
        return {}
    obj.request = request
    obj.produce('A', state, 'job', 50, 50)
    assert [(row['stage'], row['produced'], row['input_quantity']) for row in entries] == [('WINDER', 5, 0), ('OVEN', 5, 5), ('PROCESS', 50, 5), ('PACKING', 50, 50)]
    assert all(type(row[key]) is int for row in entries for key in ('produced', 'accepted', 'input_quantity'))


def test_public_card_canaries_read_each_frozen_season_and_wrong_concrete_plant():
    obj = bare(None); state = {'spec_id': 'spec', 'roy_job_id': 'roy', 'monsoon_job_id': 'mon'}
    calls = []
    def request(method, path, body=None, expected=None, **kw):
        calls.append((obj.plant, method, path, expected))
        if expected is not None:
            assert obj.plant == api.PLANTS['B'] and expected == {404}
            return httpx.Response(404)
        assert obj.plant == api.PLANTS['A']
        if '/specifications/' in path: value = {'spec': {'id': 'spec'}}
        elif path.endswith('/flow'): value = {'job_card_id': path.split('/')[-2], 'stages': [{'stage': 'WINDER'}]}
        else:
            job = path.split('/')[-1]
            value = {'id': job, 'plant_id': obj.plant, 'spec_snapshot': {'season': 'ROY' if job == 'roy' else 'MONSOON'}}
        return httpx.Response(200, json=value)
    obj.public_request = request
    obj.public_cards('A', state)
    assert len(calls) == 6 and obj.plant == api.PLANTS['A']
    assert calls[0][2] == '/api/spec/specifications/spec/season-document'
    assert calls[-1][0] == api.PLANTS['B'] and calls[-1][3] == {404}


@pytest.mark.parametrize('path', ['https://other.test.invalid/api/auth/me', '//other.test.invalid/api/auth/me', '/api/auth/me?redirect=outside', '/api/auth/me#frag'])
def test_public_requests_reject_external_or_nonfixed_paths_before_any_request(path):
    obj = bare(None)
    with pytest.raises(api.AcceptanceBlocked, match='fixed same-host'): obj.public_request('GET', path)
