#!/usr/bin/env python3
"""On-host AWS acceptance using two EXISTING bootstrap accounts.

Run only inside the deployed erp-app container, after the host has compared its
DEPLOYED_COMMIT marker and running image with the accepted release. Secrets stay
in the container environment and are never included in reports or errors. This
creates named operational/master fixtures; it never creates or changes users,
roles, passwords, or security settings. Cleanup is the separately reviewed reset.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import date, timedelta
from http.cookies import SimpleCookie
import importlib.util
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import time
import uuid

import httpx

PORTS = {'auth': 18001, 'master': 18002, 'spec': 18003, 'production': 18004,
         'inventory': 18005, 'sales': 18008, 'bff': 14000}
PLANTS = {'A': '00000000-0000-0000-0000-0000000000a1',
          'B': '00000000-0000-0000-0000-0000000000b2'}


class AcceptanceBlocked(RuntimeError):
    pass


def validate_public_host(expected_host: str) -> str:
    if (not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', expected_host)
            or '.' not in expected_host or '..' in expected_host
            or os.getenv('SITE_HOST') != expected_host
            or os.getenv('PUBLIC_APP_ORIGIN') != 'https://' + expected_host):
        raise AcceptanceBlocked('The reviewed HTTPS host must match deployed SITE_HOST and PUBLIC_APP_ORIGIN')
    return 'https://' + expected_host


def validate_execution(expected_sha: str, run: str, expected_host: str) -> None:
    if not re.fullmatch('[a-f0-9]{40}', expected_sha):
        raise AcceptanceBlocked('An exact 40-character release SHA is required')
    if os.getenv('ERP_AWS_DEPLOYED_SHA') != expected_sha:
        raise AcceptanceBlocked('The host-verified deployed SHA does not match')
    if os.getenv('ERP_AWS_ACCEPTANCE') != 'AUTHORIZED_TESTING_WORKFLOW':
        raise AcceptanceBlocked('The explicit AWS testing-workflow guard is missing')
    if os.getenv('APP_ENV') != 'production' or os.getenv('ENVIRONMENT') != 'production':
        raise AcceptanceBlocked('The deployed production container environment is required')
    if not Path('/.dockerenv').exists() or not Path('/app/deploy/aws-ec2/docker-compose.yml').is_file():
        raise AcceptanceBlocked('Run inside the deployed erp-app container')
    if not re.fullmatch('[A-Z0-9]{4,16}', run):
        raise AcceptanceBlocked('Use a unique 4-16 character alphanumeric acceptance run ID')
    for service, expected in PORTS.items():
        name = ('MASTER_PORT' if service == 'master' else service.upper() + '_PORT')
        if int(os.getenv(name, str(expected))) != expected:
            raise AcceptanceBlocked('The deployed internal service port map changed')
    validate_public_host(expected_host)


class Acceptance:
    def __init__(self, sha: str, run: str, expected_host: str):
        self.run, self.sha = run, sha
        self.state_file = Path('/app/reports') / ('aws-season-' + run.lower() + '.json')
        self.state_file.parent.mkdir(parents=True, exist_ok=True)
        self.state = json.loads(self.state_file.read_text()) if self.state_file.exists() else {
            'release_sha': sha, 'run_id': run, 'business_date': date.today().isoformat(), 'checks': [], 'plants': {}}
        if self.state.get('release_sha') != sha:
            raise AcceptanceBlocked('This acceptance run belongs to another release')
        self.business_date = date.fromisoformat(self.state['business_date'])
        self.client = httpx.Client(timeout=40)
        self.public_origin = validate_public_host(expected_host)
        self.public_client = httpx.Client(base_url=self.public_origin, timeout=40, verify=True, follow_redirects=False)
        self.identities = {}
        self.tokens: dict[str, str] = {}
        self.account = 'ADMIN'
        self.plant = PLANTS['A']
        self.metrics = self.state.setdefault('api_calls', {})

    def save(self):
        temporary = self.state_file.with_suffix('.tmp')
        with temporary.open('w') as stream:
            json.dump(self.state, stream, indent=2)
            os.chmod(temporary, 0o600)
            stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, self.state_file)

    def mark(self, check: str, **values):
        self.state['checks'].append(check)
        self.state.update(values); self.save()
        print('PASS ' + check, flush=True)

    def login(self, account: str):
        names = ('BOOTSTRAP_' + account + '_EMAIL', 'BOOTSTRAP_' + account + '_PASSWORD')
        if any(not os.getenv(name) for name in names):
            raise AcceptanceBlocked('Existing bootstrap ' + account + ' credentials are not configured')
        # No credential defaults, extraction, prints, new users or password resets.
        response = self.client.post('http://127.0.0.1:18001/auth/login',
            data={'username': os.environ[names[0]], 'password': os.environ[names[1]]})
        if response.status_code != 200:
            raise AcceptanceBlocked('Existing bootstrap ' + account + ' authentication failed (HTTP ' + str(response.status_code) + ')')
        self.tokens[account] = response.json()['access_token']

    @contextmanager
    def checker(self):
        previous = self.account
        self.account = 'OWNER'
        try: yield
        finally: self.account = previous

    def request(self, service, method, path, body=None, expected=None):
        headers = {'X-Plant-ID': self.plant, 'Authorization': 'Bearer ' + self.tokens[self.account]}
        response = self.client.request(method, 'http://127.0.0.1:' + str(PORTS[service]) + path,
                                       headers=headers, json=body)
        if response.status_code == 401:
            self.login(self.account)
            headers['Authorization'] = 'Bearer ' + self.tokens[self.account]
            response = self.client.request(method, 'http://127.0.0.1:' + str(PORTS[service]) + path,
                                           headers=headers, json=body)
        self.metrics[service] = self.metrics.get(service, 0) + 1
        if expected is not None:
            if response.status_code not in expected:
                raise AcceptanceBlocked(method + ' ' + service + ' ' + path.split('?')[0] + ': unexpected HTTP ' + str(response.status_code))
            return response
        if not response.is_success:
            # API bodies may contain submitted values; intentionally never emit them.
            raise AcceptanceBlocked(method + ' ' + service + ' ' + path.split('?')[0] + ': HTTP ' + str(response.status_code))
        result = response.json()
        if method in ('POST', 'PUT', 'DELETE'):
            # Only UUID identities enter this compact mutation index, never
            # response text, credential fields, JWTs or arbitrary labels.
            found = set()
            def collect(value):
                if isinstance(value, dict):
                    for key, item in value.items():
                        if (key == "id" or key.endswith("_id")) and isinstance(item, str):
                            try: found.add(str(uuid.UUID(item)))
                            except ValueError: pass
                        collect(item)
                elif isinstance(value, list):
                    for item in value: collect(item)
            collect(result)
            operation = service + ':' + method + ' ' + re.sub(r'[a-f0-9-]{36}', '{id}', path.split('?')[0])
            index = self.state.setdefault('response_entity_ids', {})
            index[operation] = sorted(set(index.get(operation, [])) | found)
        return result

    def command(self, label, **values):
        return {'request_id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'hariom:aws-acceptance:' + self.run + ':' + label)), **values}

    def authenticate_existing(self):
        self.request_health()
        identities = []
        for account in ('ADMIN', 'OWNER'):
            self.login(account)
            self.account = account
            user = self.request('auth', 'GET', '/auth/me')
            allowed = set(user.get('allowed_plant_ids') or user.get('allowed_plants') or [])
            if 'Owner' not in user.get('roles', []) or not set(PLANTS.values()).issubset(allowed):
                raise AcceptanceBlocked('Existing bootstrap ' + account + ' lacks Owner capability or both-plant scope')
            identities.append(user['id'])
            self.identities[account] = user['id']
        if identities[0] == identities[1]:
            raise AcceptanceBlocked('Two distinct existing accounts are required for independent approvals')
        self.account = 'ADMIN'
        self.state['account_count'] = len(set(identities))
        self.mark('Existing maker/checker identities authenticate with both-plant Owner scope')

    def public_request(self, method, path, body=None, expected=None, renew=True):
        if not path.startswith('/api/') or path.startswith('//') or '?' in path or '#' in path:
            raise AcceptanceBlocked('Public cookie canaries require fixed same-host API paths')
        response = self.public_client.request(method, path, json=body,
            headers={'Origin': self.public_origin, 'Referer': self.public_origin + '/login', 'X-Plant-ID': self.plant})
        self.metrics['public_cookie_bff'] = self.metrics.get('public_cookie_bff', 0) + 1
        if response.status_code == 401 and renew and path != '/api/auth/login':
            self.public_login()
            return self.public_request(method, path, body, expected, renew=False)
        if expected is not None:
            if response.status_code not in expected:
                raise AcceptanceBlocked('Public cookie ' + method + ' ' + path + ': unexpected HTTP ' + str(response.status_code))
            return response
        if not response.is_success:
            raise AcceptanceBlocked('Public cookie ' + method + ' ' + path + ': HTTP ' + str(response.status_code))
        return response

    def public_login(self):
        # A normal BFF login populates httpx's cookie jar. Never inject cookies or
        # use a bearer header, disable certificate checks, or follow redirects.
        names = ('BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PASSWORD')
        if any(not os.getenv(name) for name in names):
            raise AcceptanceBlocked('Existing bootstrap ADMIN credentials are not configured')
        page = self.public_client.get('/login')
        if page.status_code != 200 or 'text/html' not in page.headers.get('content-type', ''):
            raise AcceptanceBlocked('Public HTTPS Next login page is unavailable')
        response = self.public_request('POST', '/api/auth/login',
            {'email': os.environ[names[0]], 'password': os.environ[names[1]]}, renew=False)
        if not isinstance(response.json(), dict) or 'access_token' in response.json():
            raise AcceptanceBlocked('Public BFF login did not keep its bearer token private')
        cookies = SimpleCookie()
        for value in response.headers.get_list('set-cookie'): cookies.load(value)
        token = cookies.get('token')
        if (not token or not token.value or not token['secure'] or not token['httponly']
                or token['samesite'].lower() != 'lax' or token['path'] != '/' or token['domain']):
            raise AcceptanceBlocked('Public BFF session cookie flags or host-only scope are incorrect')
        user = self.public_request('GET', '/api/auth/me', renew=False).json()
        allowed = set(user.get('allowed_plant_ids') or user.get('allowed_plants') or [])
        if (user.get('id') != self.identities.get('ADMIN') or 'Owner' not in user.get('roles', [])
                or not set(PLANTS.values()).issubset(allowed)):
            raise AcceptanceBlocked('Public BFF cookie identity, Owner capability or both-plant scope differs')

    def public_cards(self, letter, state):
        spec = self.public_request('GET', '/api/spec/specifications/' + state['spec_id'] + '/season-document').json()
        if spec.get('spec', {}).get('id') != state['spec_id']:
            raise AcceptanceBlocked('Public BFF cookie specification read returned another document')
        for job, season in ((state['roy_job_id'], 'ROY'), (state['monsoon_job_id'], 'MONSOON')):
            card = self.public_request('GET', '/api/production/job-cards/' + job).json()
            flow = self.public_request('GET', '/api/production/job-cards/' + job + '/flow').json()
            if (card.get('id') != job or card.get('plant_id') != self.plant
                    or card.get('spec_snapshot', {}).get('season') != season
                    or flow.get('job_card_id') != job or not flow.get('stages')):
                raise AcceptanceBlocked('Public BFF cookie card/season/flow read failed')
        original = self.plant
        self.plant = PLANTS['B' if letter == 'A' else 'A']
        try: self.public_request('GET', '/api/production/job-cards/' + state['roy_job_id'], expected={404})
        finally: self.plant = original
        self.mark('Plant ' + letter + ': public HTTPS cookie reads reach exact specification, seasonal cards and isolated floor flow')

    def preflight(self):
        self.authenticate_existing()
        self.state.setdefault('original_season', self.request('spec', 'GET', '/season')['active_season'])
        self.save()  # Durable before any publication or organizational switch.
        self.public_login()
        self.mark('Public HTTPS BFF login uses a secure HttpOnly host-only cookie and matches existing ADMIN identity')
        # Published profiles are preserved. Only the explicitly reviewed, exact
        # initial client seed may be initialized/published; arbitrary drafts stop.
        for season in ('ROY', 'MONSOON'):
            value = self.request('spec', 'GET', '/qc-rules?season=' + season)
            if value.get('published'): continue
            if os.getenv('ERP_AWS_PUBLISH_CLIENT_SEED') != 'REVIEWED_CLIENT_RULES_2026_10_03':
                raise AcceptanceBlocked('Publish reviewed initial QC rules before acceptance, or explicitly authorize the exact client seed')
            if not value.get('draft') and not value.get('published'):
                self.request('spec', 'POST', '/season/bootstrap', self.command('bootstrap'))
                value = self.request('spec', 'GET', '/qc-rules?season=' + season)
            if not value.get('published'):
                module_spec = importlib.util.spec_from_file_location('aws_acceptance_quality', '/app/hariom-erp/shared/season_quality.py')
                quality = importlib.util.module_from_spec(module_spec); module_spec.loader.exec_module(quality)
                draft = value.get('draft') or {}
                seed = quality.initial_rules()
                if (draft.get('version') != 1 or draft.get('row_version') != 1 or draft.get('rules') != seed
                        or draft.get('fingerprint') != quality.fingerprint(seed)
                        or draft.get('change_note') != 'Client rules 2026-10-03; process ±0.2 mm and paired oven samples confirmed'):
                    raise AcceptanceBlocked('Unpublished QC draft is not the exact reviewed initial client seed; publication refused')
                self.request('spec', 'POST', '/qc-rules/draft/publish?season=' + season,
                    self.command('publish-' + season, expected_version=value['draft']['row_version'], note='Publish client seed for named AWS acceptance'))
        self.save()

    def request_health(self):
        response = self.client.get('http://127.0.0.1:14000/health/ready')
        if not response.is_success: raise AcceptanceBlocked('Deployed internal readiness is not healthy')

    def switch(self, target, label):
        if self.request('spec', 'GET', '/season')['active_season'] == target: return
        preview = self.request('spec', 'POST', '/season/switch/preview', {'to': target})
        self.request('spec', 'POST', '/season/switch', self.command(label + ':' + str(preview['epoch']), to=target,
            expected_version=preview['epoch'], preview_fingerprint=preview['fingerprint'],
            acknowledge_blocked=True, note='Named AWS acceptance ' + self.run + '; restore original season afterward'))

    def master(self, path, identity, body):
        return self.create_catalogue('master', path, identity, body)

    def create_catalogue(self, service, path, identity, body, require_owned=False):
        key = service + ':' + self.plant + ':' + path.rstrip('/') + ':' + body[identity]
        intents = self.state.setdefault('catalogue_creation_intents', {})
        rows = self.request(service, 'GET', path)
        existing = next((row for row in rows if row.get(identity) == body[identity]), None)
        if existing:
            owned = any(row['id'] == existing['id'] and row.get('created_during_run')
                for row in self.state.get('created_catalogue', []))
            if key in intents and not owned:
                intents[key]['unconfirmed_id'] = existing['id']; self.save()
                raise AcceptanceBlocked('Unconfirmed catalogue creation UUID ' + existing['id'] + '; inspect this exact checkpoint before proceeding')
            if require_owned and not owned:
                raise AcceptanceBlocked('Reused inventory item cannot be changed by acceptance; use a fresh run ID')
            return existing
        if key in intents:
            raise AcceptanceBlocked('Catalogue creation outcome remains unconfirmed; inspect the saved intent before retrying')
        intents[key] = {'identity_field': identity, 'identity_value': body[identity], 'plant_id': self.plant,
                        'service': service, 'path': path.rstrip('/')}
        self.save()  # A lost POST response must never become blind prefix adoption.
        created = self.request(service, 'POST', path, body)
        self.record_catalogue(service, path, identity, body[identity], created)
        intents[key]['confirmed_id'] = created['id']; self.save()
        return created

    def record_catalogue(self, service, path, identity, value, response):
        prefix = 'AWSSEASON_' + self.run + '_'
        if not value.startswith(prefix):
            raise AcceptanceBlocked('An acceptance catalogue record is missing its run prefix')
        records = self.state.setdefault('created_catalogue', [])
        row = {'service': service, 'path': path.rstrip('/'), 'id': response['id'],
               'plant_id': self.plant, 'identity_field': identity, 'identity_value': value,
               'created_during_run': True}
        if not any(existing['id'] == row['id'] for existing in records): records.append(row)
        self.save()

    def inventory_item(self, code, body):
        return self.create_catalogue('inventory', '/items/', 'item_code', body, require_owned=True)

    def setup(self, letter, state):
        prefix = 'AWSSEASON_' + self.run + '_' + letter
        for key, path, identity, body in [
            ('customer', '/master/customers/', 'customer_code', {'customer_code': prefix, 'name': prefix + ' customer'}),
            ('mandrel', '/master/mandrels/', 'mandrel_code', {'mandrel_code': prefix, 'outer_diameter_mm': 76.3, 'length_mm': 1560}),
            ('paper', '/master/papers/', 'code', {'code': prefix + '_PAPER', 'variety': 'Kraft', 'gsm': 300, 'bf': 20, 'bulk_factor': 1}),
            ('tube', '/master/tube-sizes/', 'description', {'description': prefix, 'inner_diameter_mm': 76.4, 'outer_diameter_mm': 81, 'length_mm': 150}),
            ('operator', '/master/employees/', 'employee_code', {'employee_code': prefix + '_OP', 'name': prefix + ' Operator', 'role': 'Operator', 'department': 'WINDER', 'default_shift': 'SHIFT_A'}),
            ('supervisor', '/master/employees/', 'employee_code', {'employee_code': prefix + '_SUP', 'name': prefix + ' Supervisor', 'role': 'Supervisor', 'department': 'WINDER', 'default_shift': 'SHIFT_A'}),
            ('supplier', '/master/suppliers/', 'supplier_code', {'supplier_code': prefix, 'name': prefix + ' supplier'}),
        ]:
            if key not in state: state[key] = self.master(path, identity, body); self.save()
        for stage, capacity, unit in [('WINDER', 5000, 'METERS_PER_DAY'), ('OVEN', 10, 'BATCHES_PER_DAY'), ('PROCESS', 1000, 'TUBES_PER_DAY'), ('PACKING', 1000, 'TUBES_PER_DAY')]:
            key = 'machine_' + stage
            if key in state: continue
            body = {'code': prefix + '_' + stage, 'name': prefix + ' ' + stage, 'department': stage,
                'capacity_type': unit, 'capacity_value': capacity, 'id_min_mm': 70, 'id_max_mm': 90,
                'od_min_mm': 75, 'od_max_mm': 100, 'length_min_mm': 100, 'length_max_mm': 2000,
                'supported_mandrel_ids': [state['mandrel']['id']]}
            if stage == 'OVEN': body.update(batch_bamboo_capacity=100, cycle_time_hours=6)
            state[key] = self.master('/master/machines/', 'code', body); self.save()
        if 'spec_id' not in state:
            module_spec = importlib.util.spec_from_file_location('aws_acceptance_spec_math', '/app/hariom-erp/services/spec-service/src/spec_math.py')
            math = importlib.util.module_from_spec(module_spec); sys.modules[module_spec.name] = math; module_spec.loader.exec_module(math)
            target = round(math.compute_preview(mandrel_od_mm=76.3, tube_length_mm=150,
                papers=[math.RecipePaper(paper_id=state['paper']['id'], gsm=300, bulk=1, ply_count=3)],
                target_dry_g=35, adhesive_percent=12.5, parchment_percent=0, parchment_allowed=False).nominal_tube.dry_g, 4)
            fields = {'customer_id': state['customer']['id'], 'customer_name': prefix,
                'customer_name_snapshot': prefix, 'tube_size_id': state['tube']['id'], 'mandrel_id': state['mandrel']['id'],
                'id_min_mm': 76.2, 'id_max_mm': 76.6, 'od_min_mm': 81, 'od_max_mm': 81,
                'length_min_mm': 149.8, 'length_max_mm': 150.2, 'target_tube_weight': target,
                'required_cs': 400, 'cs_min_n': 400, 'adhesive_percent': 12.5, 'moisture_loss_percent': 9,
                'parchment_percent': 0, 'parchment_allowed': False,
                'dynamic_fields': [{'field_key': k, 'value': v} for k, v in {
                    'valid_upto': (self.business_date + timedelta(days=365)).isoformat(), 'prepared_by': 'AWS acceptance',
                    'prepared_date': self.business_date.isoformat(), 'sign_off_note': prefix,
                    'adhesive_components_json': '[{"name":"Glue","ratio_percent":100}]'}.items()]}
            layers = [{'paper_id': state['paper']['id'], 'ply_no': i, 'gsm_snapshot': 300, 'bf_snapshot': 20, 'bulk_snapshot': 1} for i in (1, 2, 3)]
            doc = self.request('spec', 'POST', '/specs/document', self.command(letter + '-spec', spec=fields,
                recipes={'ROY': {'layers': layers, 'notes': prefix}, 'MONSOON': {'layers': layers, 'notes': prefix, 'confirm': True}}))
            state.update(spec_id=doc['spec']['id'], spec_revision=doc['spec']['write_revision'], target_weight=target); self.save()
        if not state.get('spec_approved'):
            path = '/specs/' + state['spec_id']
            self.request('spec', 'POST', path + '/season-review', self.command(letter + '-review', expected_version=state['spec_revision']))
            with self.checker():
                self.request('spec', 'POST', path + '/season-approve', self.command(letter + '-approve', expected_version=state['spec_revision']))
            state['spec_approved'] = True; self.save()
        if 'order_id' not in state:
            orders = self.request('sales', 'GET', '/sales-orders?customer_id=' + state['customer']['id'] + '&limit=500')
            order = next((row for row in orders if row.get('po_number') == prefix), None)
            order = order or self.request('sales', 'POST', '/sales-orders', {'customer_id': state['customer']['id'],
                'origin': 'CUSTOMER_PO', 'po_number': prefix, 'po_date': self.business_date.isoformat(),
                'expiry_date': (self.business_date + timedelta(days=90)).isoformat(),
                'lines': [{'approved_spec_id': state['spec_id'], 'qty': 100, 'due_date': (self.business_date + timedelta(days=7)).isoformat(), 'rate_per_pc': 5, 'product_code': prefix}]})
            state.update(order_id=order['id'], line_id=order['lines'][0]['id']); self.save()
        if not state.get('order_approved'):
            order = self.request('sales', 'GET', '/sales-orders/' + state['order_id'])
            if order['status'] in ('DRAFT', 'SUBMITTED'):
                self.request('sales', 'POST', '/sales-orders/' + state['order_id'] + '/approve', expected={403})
                with self.checker(): self.request('sales', 'POST', '/sales-orders/' + state['order_id'] + '/approve')
            state['order_approved'] = True; self.save()
        self.mark('Plant ' + letter + ': named masters, dual recipes and independent Sales approval')

    def release(self, letter, state, season):
        key = season.lower() + '_job_id'
        if key in state: return state[key]
        lot_id = str(uuid.uuid5(uuid.NAMESPACE_URL, 'hariom:aws:' + self.run + ':' + letter + ':' + season + ':lot'))
        self.request('sales', 'POST', '/sales-orders/lines/' + state['line_id'] + '/release',
            {'release_qty': 50, 'winder_machine_id': state['machine_WINDER']['id'], 'release_lot_id': lot_id})
        result = self.request('production', 'POST', '/sales-orders/' + state['order_id'] + '/release-sync',
            {'release_rows': [{'sales_order_line_id': state['line_id'], 'release_lot_id': lot_id,
              'winder_machine_id': state['machine_WINDER']['id'], 'release_qty': 50}]})
        state[key] = result['line_results'][0]['job_card_id']; self.save()
        return state[key]

    def seasons(self, letter, state):
        self.switch('ROY', letter + '-select-roy')
        roy = self.release(letter, state, 'ROY')
        frozen = self.request('production', 'GET', '/job-cards/' + roy)['spec_snapshot']['release_bundle_hash']
        if not state.get('monsoon_edit'):
            sid = state['spec_id']; doc = self.request('spec', 'GET', '/specs/' + sid + '/season-document')
            original = state.setdefault('roy_recipe_id', doc['recipes']['ROY']['id'])
            if 'monsoon_edit_input' not in state:
                preview = self.request('spec', 'POST', '/season/switch/preview', {'to': 'MONSOON'})
                state['monsoon_stale_preview'] = {'epoch': preview['epoch'], 'fingerprint': preview['fingerprint']}
                state['monsoon_edit_input'] = {'expected_version': doc['recipes']['MONSOON']['row_version'], 'layers': doc['recipes']['MONSOON']['layers']}
                self.save()
            stale = state['monsoon_stale_preview']
            edited = self.request('spec', 'PUT', '/specs/' + sid + '/recipes/MONSOON/revision',
                self.command(letter + '-monsoon-edit', **state['monsoon_edit_input'], confirm=True, note='Independent Monsoon revision for AWS acceptance'))
            with self.checker():
                self.request('spec', 'POST', '/specs/' + sid + '/recipes/MONSOON/approve',
                    self.command(letter + '-monsoon-approve', expected_version=edited['recipes']['MONSOON']['draft']['row_version'], note='Independent AWS acceptance review'))
            self.request('spec', 'POST', '/season/switch', self.command(letter + '-stale-switch', to='MONSOON',
                expected_version=stale['epoch'], preview_fingerprint=stale['fingerprint'], note='Stale preview must fail'), expected={409})
            doc = self.request('spec', 'GET', '/specs/' + sid + '/season-document')
            if doc['recipes']['ROY']['id'] != original or doc['recipes']['MONSOON']['season_revision'] != 2:
                raise AcceptanceBlocked('Season-specific recipe revision independence failed')
            state.update(monsoon_edit=True, roy_recipe_id=original, monsoon_recipe_id=doc['recipes']['MONSOON']['id']); self.save()
        self.switch('MONSOON', letter + '-select-monsoon')
        bom = self.request('spec', 'GET', '/calculate/bom-for-spec/' + state['spec_id'])
        if bom['recipe_id'] != state['monsoon_recipe_id']: raise AcceptanceBlocked('Unreleased demand did not select Monsoon revision')
        demand = self.request('bff', 'GET', '/api/purchase/material-demand?as_of_date=' + self.business_date.isoformat() + '&horizon_end=' + (self.business_date + timedelta(days=30)).isoformat())
        own = [row for row in demand['requirements'] if row['line_id'] == state['line_id']]
        if not state.get('monsoon_job_id'):
            live = [row for row in own if row['basis'] == 'UNRELEASED_OPEN_SALES_BOM']
            frozen_rows = [row for row in own if row['basis'] == 'FROZEN_JOB_RESIDUAL']
            if not live or not frozen_rows or any(row['recipe_id'] != state['monsoon_recipe_id'] or row['open_units'] != 50 for row in live) or any(row['recipe_id'] != state['roy_recipe_id'] or row['open_units'] != 50 for row in frozen_rows):
                raise AcceptanceBlocked('Mixed released/unreleased Sales material demand did not preserve its two recipe bases')
        mon = self.release(letter, state, 'MONSOON')
        detail = self.request('production', 'GET', '/job-cards/' + mon)
        if detail['spec_snapshot']['season'] != 'MONSOON' or detail['material_plan_snapshot']['recipe_snapshot']['season_revision'] != 2:
            raise AcceptanceBlocked('New release did not freeze Monsoon revision 2')
        mon_hash = detail['spec_snapshot']['release_bundle_hash']
        previous_plant = self.plant
        self.plant = PLANTS['B' if letter == 'A' else 'A']
        try: self.request('production', 'GET', '/job-cards/' + roy, expected={404})
        finally: self.plant = previous_plant
        self.switch('ROY', letter + '-return-roy')
        for job, expected in ((roy, frozen), (mon, mon_hash)):
            if self.request('production', 'GET', '/job-cards/' + job)['spec_snapshot']['release_bundle_hash'] != expected:
                raise AcceptanceBlocked('A released recipe/QC bundle changed across a season switch')
        self.public_cards(letter, state)
        self.mark('Plant ' + letter + ': unreleased season selection, independent Monsoon revision and immutable released cards')

    def procurement(self, letter, state):
        prefix = 'AWSSEASON_' + self.run + '_' + letter
        if 'raw_item_id' not in state:
            item = self.inventory_item(state['paper']['code'], {'item_code': state['paper']['code'], 'name': prefix + ' paper', 'type': 'RAW_PAPER', 'tracking_mode': 'REEL', 'uom': 'KG'})
            saved = self.request('inventory', 'PUT', '/items/' + item['id'] + '/quality-profile',
                {'quality_profile': {'parameters': [{'code': 'gsm', 'label': 'GSM', 'min': 290, 'max': 310, 'required': True, 'unit': 'gsm'}]}, 'setup_status': 'complete'})
            self.request('inventory', 'POST', '/items/' + item['id'] + '/quality-profile/approve', {'expected_revision': saved['quality_profile']['revision']}, expected={409})
            with self.checker(): self.request('inventory', 'POST', '/items/' + item['id'] + '/quality-profile/approve', {'expected_revision': saved['quality_profile']['revision']})
            state['raw_item_id'] = item['id']; self.save()
        if 'po_id' not in state:
            po = self.request('inventory', 'POST', '/inventory/purchase/orders', self.command(letter + '-po',
                supplier_id=state['supplier']['id'], supplier_name=state['supplier']['name'], po_date=self.business_date.isoformat(), expected_date=self.business_date.isoformat(),
                lines=[{'item_id': state['raw_item_id'], 'qty_ordered': 100, 'unit_cost': 50, 'uom': 'KG', 'incoming_qc_required': True, 'gsm': 300, 'width_mm': 1500}]))
            state.update(po_id=po['id'], po_line_id=po['lines'][0]['id']); self.save()
        if not state.get('po_approved'):
            po = self.request('inventory', 'GET', '/inventory/purchase/orders/' + state['po_id'])
            if po['status'] == 'DRAFT': po = self.request('inventory', 'POST', '/inventory/purchase/orders/' + po['id'] + '/submit', {'expected_version': po['version']})
            if po['status'] == 'SUBMITTED':
                self.request('inventory', 'POST', '/inventory/purchase/orders/' + po['id'] + '/approve', {'expected_version': po['version'], 'reason': prefix}, expected={403})
                with self.checker(): self.request('inventory', 'POST', '/inventory/purchase/orders/' + po['id'] + '/approve', {'expected_version': po['version'], 'reason': prefix + ' independent Owner approval'})
            state['po_approved'] = True; self.save()
        if 'receipt_id' not in state:
            body = self.command(letter + '-receipt', purchase_order_id=state['po_id'], received_date=self.business_date.isoformat(), invoice_pending=True,
                lines=[{'po_line_id': state['po_line_id'], 'lots': [{'source_reel_no': prefix, 'net_weight_kg': 100, 'width_mm': 1500}]}])
            receipt = self.request('inventory', 'POST', '/inventory/procurement/receipts', body)
            if self.request('inventory', 'POST', '/inventory/procurement/receipts', body)['id'] != receipt['id']: raise AcceptanceBlocked('Inward replay created another receipt')
            state.update(receipt_id=receipt['id'], reel_id=receipt['lots'][0]['id']); self.save()
        if not state.get('inward_cleared'):
            inspected = self.request('inventory', 'POST', '/inventory/quality/inspections', {'entity_type': 'REEL', 'entity_id': state['reel_id'],
                'readings': {'gsm': 300}, 'sample_count': 2, 'sample_ids': [str(uuid.uuid4()), str(uuid.uuid4())]})
            if inspected['status'] != 'PASS': raise AcceptanceBlocked('Incoming material QC failed')
            receipt = self.request('inventory', 'GET', '/inventory/procurement/receipts/' + state['receipt_id'])
            if receipt['invoice_pending']:
                self.request('inventory', 'POST', '/reel-issues', {'reel_id': state['reel_id'], 'issue_section': 'SLITTING_SECTION', 'shift': 'A',
                    'issue_date': self.business_date.isoformat(), 'issued_weight_kg': 100}, expected={400, 409})
                self.request('inventory', 'POST', '/inventory/procurement/receipts/' + state['receipt_id'] + '/attach-invoice', {'expected_version': receipt['posting_version'],
                    'invoice_no': prefix, 'invoice_date': self.business_date.isoformat(), 'lines': [{'receipt_line_id': receipt['lines'][0]['id'], 'invoice_quantity': 100, 'invoice_rate': 50}]})
            state['inward_cleared'] = True; self.save()
        if 'coil_id' not in state:
            children = self.request('inventory', 'GET', '/reels?physical_form=COIL&limit=500')
            recovered = [row for row in children if row.get('parent_reel_id') == state['reel_id']]
            if recovered:
                state['coil_id'] = recovered[0]['id']; self.save()
        if 'coil_id' not in state:
            issues = self.request('inventory', 'GET', '/reel-issues?status=OPEN')
            if not any(row['reel_id'] == state['reel_id'] for row in issues):
                self.request('inventory', 'POST', '/reel-issues', {'reel_id': state['reel_id'], 'issue_section': 'SLITTING_SECTION', 'shift': 'A',
                    'issue_date': self.business_date.isoformat(), 'issued_weight_kg': 100})
            result = self.request('inventory', 'POST', '/reels/slit', {'parent_reel_id': state['reel_id'], 'children': [{'weight_kg': 49.5, 'width_mm': 750}, {'weight_kg': 49.5, 'width_mm': 750}],
                'trim_wastage_kg': 1, 'slit_date': self.business_date.isoformat(), 'remarks': prefix + ' mass conservation'})
            if sum(row['weight_kg'] for row in result['children']) + result['trim_wastage_kg'] != 100: raise AcceptanceBlocked('Slitting mass conservation failed')
            state['coil_id'] = result['child_reel_ids'][0]; state['slit_child_ids'] = result['child_reel_ids']; self.save()
        if 'fg_item_id' not in state:
            item = self.inventory_item(prefix + '_FG', {'item_code': prefix + '_FG', 'name': prefix + ' tubes', 'type': 'FINISHED_GOOD', 'uom': 'PCS'})
            state['fg_item_id'] = item['id']; self.save()
        self.mark('Plant ' + letter + ': independent PO/material-QC approvals, invoice issue gate, inward replay and mass-conserving slitting')

    def floor(self, job): return self.request('production', 'GET', '/job-cards/' + job + '/flow')
    def stage(self, job, stage): return next(row for row in self.floor(job)['stages'] if row['stage'] == stage)

    def material_issue(self, state, job):
        assigned = state.setdefault('material_issues', {})
        if job in assigned: return assigned[job]
        body = {'reel_id': state['coil_id'], 'issue_section': 'WINDER_SECTION',
            'machine_id': state['machine_WINDER']['id'], 'shift': 'A', 'issue_date': self.business_date.isoformat(),
            'issued_weight_kg': 5, 'customer_id': state['customer']['id'], 'sales_order_id': state['order_id']}
        path = ('/reel-issues?reel_id=' + body['reel_id'] + '&machine_id=' + body['machine_id']
                + '&issue_section=WINDER_SECTION&shift=A&issue_date=' + body['issue_date'] + '&limit=500')
        rows = self.request('inventory', 'GET', path)
        intents = state.setdefault('material_issue_intents', {})
        if job in intents:
            baseline = set(intents[job]['baseline_ids']) | set(assigned.values())
            matches = [row for row in rows if row['id'] not in baseline and row.get('plant_id') == self.plant
                and all(str(row.get(key)) == str(value) for key, value in body.items() if key != 'issued_weight_kg')
                and float(row.get('issued_weight_kg', -1)) == 5]
            if len(matches) != 1:
                raise AcceptanceBlocked('Material issue outcome is ambiguous; inspect the per-job pending intent before retrying')
            issue = matches[0]
        else:
            intents[job] = {'baseline_ids': [row['id'] for row in rows], 'body': body}
            self.save()
            issue = self.request('inventory', 'POST', '/reel-issues', body)
        assigned[job] = issue['id']; intents[job]['confirmed_id'] = issue['id']; self.save()
        return issue['id']

    def produce(self, letter, state, job, quantity, accepted, continuous=False):
        detail = self.request('production', 'GET', '/job-cards/' + job)
        pcs = detail['spec_snapshot'].get('pcs_per_bamboo') or detail['spec_snapshot'].get('tubes_per_bamboo') or detail['material_plan_snapshot'].get('pcs_per_bamboo')
        if (type(quantity) is not int or type(accepted) is not int or not 0 <= accepted <= quantity
                or pcs != 10 or quantity % 10):
            raise AcceptanceBlocked('Named acceptance requires exact integer quantities and frozen ten-piece bamboo conversion')
        bamboo = quantity // 10
        profile = detail['spec_snapshot']['qc_profile']
        values = {'WINDER': {'id': 76.3, 'od': 82, 'height': profile['refs']['WINDING_LENGTH'], 'weight': state['target_weight'] * 11, 'cs': 165},
            'OVEN': {'pre_weight': 1000, 'post_weight': 910, 'pre_moisture': 10, 'post_moisture': 8, 'cs': 420},
            'PROCESS': {'id': 76.4, 'od': 81, 'height': 150, 'weight': state['target_weight'], 'cs': 420, 'moisture': 8}}
        def samples(readings): return [{'sample_id': str(uuid.uuid4()), 'readings': readings} for _ in range(2)]
        def enter(stage, qty, input_qty, mode='TOTAL', suffix='total'):
            row = self.stage(job, stage)
            return self.request('production', 'POST', '/job-cards/' + job + '/entries', self.command(job + ':' + stage + ':' + suffix,
                stage=stage, quantity_mode=mode, expected_version=row['row_version'] if mode == 'TOTAL' else None,
                business_date=self.business_date.isoformat(), shift_code='SHIFT_A', operator_id=state['operator']['id'],
                produced=qty, accepted=qty, input_quantity=input_qty, samples=samples(values[stage]) if stage in values else [], submit=True))
        for stage in ('WINDER', 'OVEN', 'PROCESS', 'PACKING'):
            if self.stage(job, stage)['status'] != 'COMPLETED':
                self.request('production', 'POST', '/job-cards/' + job + '/assign-machine', {'stage': stage,
                    'machine_id': state['machine_' + stage]['id'], 'plan_date': self.business_date.isoformat(), 'shift_code': 'SHIFT_A', 'sequence_no': 1})
        if continuous and not self.stage(job, 'WINDER')['produced_total']:
            enter('WINDER', 2, 0, 'DELTA', 'overlap'); enter('OVEN', 2, 2, 'DELTA', 'overlap'); enter('PROCESS', 20, 2, 'DELTA', 'overlap')
            if any(self.stage(job, s)['status'] != 'RUNNING' for s in ('WINDER', 'OVEN', 'PROCESS')): raise AcceptanceBlocked('Continuous downstream batch overlap failed')
            self.mark('Plant ' + letter + ': Winding/Oven/Process overlap with bounded inputs')
        self.material_issue(state, job)
        if job not in state.setdefault('material_consumption_closed', []):
            consumption = sum(float(p['weight_kg']) for p in detail['material_plan_snapshot']['bom_snapshot']['raw_materials']['papers']) * bamboo
            matches = self.request('inventory', 'GET', '/reel-issues?issue_ids=' + state['material_issues'][job])
            closed = matches[0] if matches and matches[0]['status'] == 'CLOSED' else self.request('inventory', 'POST', '/reel-issues/' + state['material_issues'][job] + '/close', {'consumed_weight_kg': consumption})
            if abs(closed['consumed_weight_kg'] - consumption) > .00001: raise AcceptanceBlocked('Actual winding material consumption did not reconcile')
            state['material_consumption_closed'].append(job); self.save()
        for stage in ('WINDER', 'OVEN', 'PROCESS', 'PACKING'):
            row = self.stage(job, stage)
            if row['status'] == 'COMPLETED': continue
            qty = bamboo if stage in ('WINDER', 'OVEN') else quantity
            inputs = 0 if stage == 'WINDER' else bamboo if stage in ('OVEN', 'PROCESS') else quantity
            if row['produced_total'] < qty: enter(stage, qty, inputs)
            self.request('production', 'POST', '/job-cards/' + job + '/stages/' + stage + '/close', self.command(job + ':' + stage + ':close',
                expected_version=self.stage(job, stage)['row_version'], supervisor_id=state['supervisor']['id'],
                fg_item_id=state['fg_item_id'] if stage == 'PACKING' else None,
                reel_issue_ids=[state['material_issues'][job]] if stage == 'WINDER' else []))
        if self.stage(job, 'QC')['status'] != 'COMPLETED':
            self.request('production', 'POST', '/job-cards/' + job + '/fg-inward/retry', {}, expected={409, 422})
            readings = {'id': 76.4, 'od': 81, 'length': 150, 'weight': state['target_weight'], 'cs': 420}
            if not self.floor(job)['final_samples']:
                self.request('production', 'POST', '/quality/inspections/import', {'rows': [{'job_card_id': job, 'stage_type': 'QC',
                    'sample_id': str(uuid.uuid4()), 'readings': readings, 'final_submission': True} for _ in range(2)]})
            if not self.stage(job, 'QC')['produced_total']:
                self.request('production', 'POST', '/job-cards/' + job + '/entries', self.command(job + ':QC:entry', stage='QC',
                    business_date=self.business_date.isoformat(), shift_code='SHIFT_A', operator_id=state['operator']['id'],
                    produced=quantity, accepted=accepted, input_quantity=quantity,
                    details={'reject_reason': 'Named AWS acceptance segregated rejects'} if accepted < quantity else {}, submit=True))
            self.request('production', 'POST', '/job-cards/' + job + '/stages/QC/close', self.command(job + ':QC:close',
                expected_version=self.stage(job, 'QC')['row_version'], supervisor_id=state['supervisor']['id'],
                short_close=accepted < quantity, reason='Named AWS acceptance final QC'))
        for _ in range(40):
            packing = self.request('production', 'GET', '/job-cards/' + job).get('packing_record') or {}
            if (packing.get('snapshot') or {}).get('inventory_batch_id'):
                if float(packing['snapshot'].get('fg_accepted_qty', accepted)) != accepted: raise AcceptanceBlocked('FG inward included pieces excluded by final QC')
                return packing
            time.sleep(1)
        raise AcceptanceBlocked('Durable accepted-FG posting did not finish')

    def dispatch(self, state, job, qty, label):
        body = {'job_card_id': job, 'status': 'SEALED', 'dispatch_request_id': self.command(job + ':dispatch:' + label)['request_id'],
            'dispatch_qty': qty, 'dispatch_snapshot': {'date': self.business_date.isoformat(), 'challan_no': 'AWSSEASON_' + self.run + '_' + label}}
        result = self.request('production', 'POST', '/dispatch/', body)
        if self.request('production', 'POST', '/dispatch/', body)['id'] != result['id']: raise AcceptanceBlocked('Dispatch replay created another shipment')
        state.setdefault('dispatch_ids', {})[job + ':' + label] = result['id']; self.save()

    def finish(self, letter, state):
        roy, mon = state['roy_job_id'], state['monsoon_job_id']
        self.produce(letter, state, roy, 50, 50, continuous=True); self.dispatch(state, roy, 50, letter + '-roy')
        self.produce(letter, state, mon, 50, 40)
        self.dispatch(state, mon, 30, letter + '-mon-partial30'); self.dispatch(state, mon, 10, letter + '-mon-partial10')
        codes = self.request('master', 'GET', '/master/reason-codes/?category=SHORT_CLOSE')
        codes = [row for row in codes if row.get('is_active', True) and row.get('active', True)]
        if not codes:
            code = 'AWSSEASON_' + self.run + '_' + letter + '_SHORT'
            created = self.master('/master/reason-codes/', 'code', {'code': code, 'label': 'Named AWS acceptance remake',
                'category': 'SHORT_CLOSE', 'severity': 'WATCH', 'description': 'Testing final-QC accepted quantity shortage'})
            codes = [created]
        body = {'produced_qty': 40, 'reason_code': codes[0]['code'], 'stage_type': 'JOB_CARD', 'decision': 'CARRY_FORWARD', 'notes': 'AWS acceptance: remake only final QC rejected ten pieces'}
        decision = self.request('production', 'POST', '/operations/short-close/' + mon, body)
        if self.request('production', 'POST', '/operations/short-close/' + mon, body)['id'] != decision['id']: raise AcceptanceBlocked('Shortage decision replay duplicated work')
        child = decision['carry_forward_job_card_id']; state['carry_job_id'] = child; self.save()
        parent = self.request('production', 'GET', '/job-cards/' + mon)
        remake = self.request('production', 'GET', '/job-cards/' + child)
        if remake['spec_snapshot']['release_bundle_hash'] != parent['spec_snapshot']['release_bundle_hash'] or len(self.floor(child)['stages']) != len(self.floor(mon)['stages']):
            raise AcceptanceBlocked('Replacement route or frozen recipe/QC lineage changed')
        self.produce(letter, state, child, 10, 10); self.dispatch(state, child, 10, letter + '-remake')
        line = self.request('sales', 'GET', '/sales-orders/lines/' + state['line_id'])
        if float(line['fulfilled_qty']) != 100 or float(line['qty']) != 100: raise AcceptanceBlocked('Final Sales fulfillment differs from the approved hundred pieces')
        if any(self.request('production', 'GET', '/job-cards/' + job)['status'] != 'COMPLETED' for job in (roy, mon, child)):
            raise AcceptanceBlocked('A fully shipped accepted batch remained open')
        state['complete'] = True; self.save()
        self.mark('Plant ' + letter + ': physical material issues, two-sample QC, accepted FG, partial dispatch and frozen remake fulfill Sales100 exactly once')


    def cleanup_catalogue(self, reset_manifest: Path, apply=False, fingerprint=None, confirm=None):
        if not self.state.get('complete'):
            raise AcceptanceBlocked('Complete this named acceptance run before cleaning its catalogue')
        reset = json.loads(reset_manifest.read_text())
        if reset.get('status') != 'COMPLETE' or reset.get('release_commit') != self.sha:
            raise AcceptanceBlocked('A completed operational reset for the same product SHA is required')
        for data in reset.get('databases', {}).values():
            if not data.get('cleared') or any(data.get('after', {}).get(table, -1) != 0 for table in data.get('clear', [])):
                raise AcceptanceBlocked('The operational reset has no verified zero-row result')
        if set(reset.get('databases', {})) != {'authdb', 'masterdb', 'specdb', 'salesdb', 'productiondb', 'inventorydb', 'analyticsdb'}:
            raise AcceptanceBlocked('The reviewed reset must cover all seven databases')
        self.authenticate_existing()
        prefix = 'AWSSEASON_' + self.run + '_'
        allowed = {'master': {'/master/customers', '/master/machines', '/master/employees', '/master/papers',
            '/master/mandrels', '/master/tube-sizes', '/master/suppliers', '/master/reason-codes'}, 'inventory': {'/items'}}
        plan, counts = [], {}
        for row in self.state.get('created_catalogue', []):
            if (not row.get('created_during_run') or row['service'] not in allowed or row['path'] not in allowed[row['service']]
                    or not row['identity_value'].startswith(prefix) or row['plant_id'] not in PLANTS.values()):
                raise AcceptanceBlocked('Catalogue provenance does not match this named run')
            self.plant = row['plant_id']
            if row['service'] == 'inventory':
                current = self.request('inventory', 'GET', row['path'] + '/' + row['id'])
            else:
                rows = self.request('master', 'GET', row['path'] + '/?include_inactive=true')
                current = next((item for item in rows if item['id'] == row['id']), None)
            if not current or current.get(row['identity_field']) != row['identity_value'] or current.get('plant_id') != row['plant_id']:
                raise AcceptanceBlocked('A created catalogue identity changed or moved plant before cleanup')
            active = current.get('is_active', current.get('active', True))
            active = active is True or str(active).lower() == 'true'
            plan.append({**row, 'active': active})
            kind = row['service'] + ':' + row['path'].split('/')[-1]
            counts[kind] = counts.get(kind, 0) + int(active)
        digest = hashlib.sha256(json.dumps(plan, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
        if not apply:
            self.state['catalogue_cleanup_preview'] = {'fingerprint': digest, 'records': plan, 'active_counts': counts, 'reset_id': reset['reset_id']}
            self.save()
            print(json.dumps({'cleanup_fingerprint': digest, 'active_counts': counts, 'created_ids': [r['id'] for r in plan]}, sort_keys=True))
            return
        if (confirm != 'DISABLE ONLY CREATED AWS ACCEPTANCE CATALOGUE' or fingerprint != digest
                or (self.state.get('catalogue_cleanup_preview') or {}).get('fingerprint') != digest):
            raise AcceptanceBlocked('Review the exact catalogue preview and pass its fingerprint and scope confirmation')
        disabled = []
        for row in plan:
            if not row['active']: continue
            self.plant = row['plant_id']
            # Normal API deactivation, never force=true and never hard deletion.
            self.request(row['service'], 'DELETE', row['path'] + '/' + row['id'])
            disabled.append(row['id'])
            self.state.setdefault('catalogue_disabled_ids', []).append(row['id']); self.save()
        # Verify all originally created rows are inactive through their supported
        # maintenance reads. Reused/preexisting masters never enter this plan.
        for row in plan:
            self.plant = row['plant_id']
            if row['service'] == 'inventory': current = self.request('inventory', 'GET', row['path'] + '/' + row['id'])
            else:
                current = next(item for item in self.request('master', 'GET', row['path'] + '/?include_inactive=true') if item['id'] == row['id'])
            if current.get('is_active', current.get('active', False)) in (True, 'true'):
                raise AcceptanceBlocked('A named acceptance catalogue row remains active after cleanup')
        self.state['catalogue_cleanup_complete'] = True; self.save()
        print(json.dumps({'catalogue_cleanup_complete': True, 'disabled_count': len(disabled), 'disabled_ids': disabled, 'active_counts_after': {key: 0 for key in counts}}, sort_keys=True))

    def run_all(self):
        failed = False
        try:
            self.preflight()
            for letter, plant in PLANTS.items():
                self.plant = plant
                state = self.state['plants'].setdefault(letter, {'plant_id': plant})
                if state.get('complete'): continue
                self.setup(letter, state); self.seasons(letter, state); self.procurement(letter, state); self.finish(letter, state)
        except Exception:
            failed = True
            raise
        finally:
            self.account = 'ADMIN'
            # Even failed acceptance restores the organizational season setting.
            # Test fixtures remain named and reviewable for the separate reset.
            if self.state.get('original_season'):
                try:
                    if not self.tokens.get('ADMIN'): self.login('ADMIN')
                    self.switch(self.state['original_season'], 'restore-original-season')
                    self.state['season_restoration_required'] = False
                except Exception:
                    self.state['season_restoration_required'] = True
                    if not failed:
                        raise AcceptanceBlocked('Original season restoration failed; inspect the named checkpoint on-host') from None
                    print('BLOCKED Original season restoration remains required; inspect the named checkpoint on-host', flush=True)
                finally: self.save()
        self.mark('AWS authenticated acceptance complete; original season restored', complete=True)
        print(json.dumps({'release_sha': self.sha, 'run_id': self.run, 'plants_completed': 2,
            'sales_fulfilled_qty': 200, 'job_cards_completed': 6, 'dispatch_count': 8,
            'report': str(self.state_file)}, sort_keys=True), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--expected-sha', required=True)
    parser.add_argument('--expected-host', required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--catalogue-cleanup', choices=('preview', 'apply'))
    parser.add_argument('--reset-manifest', type=Path)
    parser.add_argument('--cleanup-fingerprint')
    parser.add_argument('--confirm')
    args = parser.parse_args()
    try:
        validate_execution(args.expected_sha, args.run, args.expected_host)
        acceptance = Acceptance(args.expected_sha, args.run, args.expected_host)
        if args.catalogue_cleanup:
            if not args.reset_manifest: raise AcceptanceBlocked('Pass the exact completed operational reset manifest')
            acceptance.cleanup_catalogue(args.reset_manifest, apply=args.catalogue_cleanup == 'apply',
                fingerprint=args.cleanup_fingerprint, confirm=args.confirm)
        else: acceptance.run_all()
    except Exception as exc:
        # No traceback, response body, credentials or token can escape in errors.
        message = str(exc) if isinstance(exc, AcceptanceBlocked) else 'Unexpected ' + type(exc).__name__ + '; inspect the named fixture checkpoint on-host'
        print('BLOCKED ' + message, flush=True)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
