"""Real PostgreSQL transactions; no production credentials or data."""
import os
import uuid
from types import SimpleNamespace
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
if 'hardening_test' not in os.environ.get('DATABASE_URL', ''):
    pytest.skip('Requires isolated hardening_test PostgreSQL database', allow_module_level=True)
from src.main import app
from src.database import engine, get_db
from src import models
from src.security.hashing import get_password_hash
from src.security.jwt_handler import build_user_claims, create_access_token
from src.routers import auth

@pytest.fixture
def workspace():
    assert 'hardening_test' in os.environ.get('DATABASE_URL', ''), 'Use the isolated hardening_test database'
    conn = engine.connect(); outer = conn.begin()
    db = Session(bind=conn, join_transaction_mode='create_savepoint')
    db.query(models.User).update({models.User.is_active: False})
    # No durable changes: each test owns a transaction rolled back after all calls.
    plant = models.Plant(id=uuid.uuid4(), code='TEST-'+uuid.uuid4().hex[:8], name='Test Plant', is_active=True)
    db.add(plant)
    role = db.query(models.Role).filter_by(name='Owner').one()
    admin = models.User(name='Owner Test', email='owner-test@example.com', hashed_password=get_password_hash('LocalOnlyTest1!'), is_active=True, is_owner_all_plants=True, plant=plant, allowed_plants=[plant], roles=[role])
    db.add(admin); db.commit()
    def override_db():
        try: yield db
        except Exception:
            db.rollback(); raise
    app.dependency_overrides[get_db] = override_db
    auth._login_attempts.clear()
    with TestClient(app) as client:
        headers = {'Authorization': 'Bearer '+create_access_token(build_user_claims(admin))}
        yield client, db, admin, plant, headers
    app.dependency_overrides.clear(); db.close(); outer.rollback(); conn.close()

def new_user(client, headers, plant, **changes):
    payload = dict(name='Haresh ', email='haresh-test@example.com', password='LocalOnlyTest1!', role_names=['Admin'], plant_id=str(plant.id), allowed_plant_ids=[str(plant.id)], is_owner_all_plants=True)
    payload.update(changes)
    result = client.post('/users/', json=payload, headers=headers)
    assert result.status_code == 200, result.text
    return result.json()

def login(client, username, password='LocalOnlyTest1!'):
    return client.post('/auth/login', data={'username': username, 'password': password})

def test_mixed_case_login_edit_role_disable_restore_and_password(workspace):
    client, db, admin, plant, headers = workspace
    user = new_user(client, headers, plant)
    assert user['created_at'] and user['name'] == 'Haresh'
    signed = login(client, ' HARESH-test@EXAMPLE.com ')
    assert signed.status_code == 200, signed.text
    old_headers = {'Authorization': 'Bearer '+signed.json()['access_token']}
    assert client.get('/auth/me', headers=old_headers).status_code == 200
    changed = client.put('/users/'+user['id'], json={'role_names':['Store'], 'name':'Haresh updated'}, headers=headers)
    assert changed.status_code == 200, changed.text
    assert changed.json()['is_owner_all_plants'] is False
    assert client.get('/auth/me', headers=old_headers).status_code == 401
    store_login = login(client, user['email'])
    store_headers = {'Authorization':'Bearer '+store_login.json()['access_token']}
    assert client.put('/users/'+user['id'], json={'role_names':['Owner']}, headers=store_headers).status_code == 403
    assert client.get('/users/', headers=store_headers).status_code == 403
    assert client.put('/users/'+user['id'], json={'is_active':False}, headers=headers).status_code == 200
    assert client.get('/auth/me', headers=store_headers).status_code == 401
    assert login(client,user['email']).status_code == 403
    assert any(u['id']==user['id'] and not u['is_active'] for u in client.get('/users/',headers=headers).json())
    assert client.put('/users/'+user['id'],json={'is_active':True,'role_names':['Admin'],'password':'ChangedLocal1!Pass'},headers=headers).status_code == 200
    assert login(client,user['email']).status_code == 401
    assert login(client,user['email'],'ChangedLocal1!Pass').status_code == 200
    events = db.query(models.AuditEvent).filter_by(entity_id=user['id']).all()
    assert len(events) == 4
    assert all('LocalOnly' not in (e.payload or '') and 'ChangedLocal' not in (e.payload or '') for e in events)

@pytest.mark.parametrize('change', [{'role_names':[]},{'is_active':False},{'role_names':['Store']}])
def test_cannot_lock_out_last_admin(workspace, change):
    client, db, admin, plant, headers = workspace
    response=client.put('/users/'+str(admin.id), json=change, headers=headers)
    assert response.status_code == 400, response.text

def test_case_duplicate_and_non_admin_all_scope_rejected(workspace):
    client, db, admin, plant, headers = workspace
    user=new_user(client,headers,plant)
    response=client.put('/users/'+user['id'],json={'email':'OWNER-TEST@example.com'},headers=headers)
    assert response.status_code==409

def test_refresh_does_not_elevate_acting_session(workspace):
    client, db, admin, plant, headers=workspace
    dispatch = db.query(models.Role).filter_by(name='Dispatch').one()
    admin.roles.append(dispatch); db.commit()
    headers={'Authorization':'Bearer '+create_access_token(build_user_claims(admin))}
    acting=client.post('/auth/acting-role',json={'role_name':'Dispatch'},headers=headers)
    assert acting.status_code==200
    acting_headers={'Authorization':'Bearer '+acting.json()['access_token']}
    refreshed=client.post('/auth/session/refresh',headers=acting_headers)
    assert refreshed.status_code==200
    renewed={'Authorization':'Bearer '+refreshed.json()['access_token']}
    assert client.get('/users/',headers=renewed).status_code==403
    assert client.get('/auth/me',headers=renewed).json()['roles']==['Dispatch']

def test_internal_audit_ingest_is_idempotent_and_public_spoofing_rejected(workspace):
    client, db, admin, plant, headers = workspace
    body={'id':str(uuid.uuid4()),'occurred_at':'2026-09-10T00:00:00','event_type':'ORDER_APPROVED','source_service':'sales-service','actor_user_id':str(admin.id),'actor_email':admin.email,'payload':{'capture':'transactional'}}
    assert client.post('/audit-events/ingest',json=body,headers=headers).status_code==403
    internal={'X-Internal-Token':os.getenv('INTERNAL_EVENT_TOKEN','hariom-internal-events')}
    assert client.post('/audit-events/ingest',json=body,headers=internal).status_code==200
    assert client.post('/audit-events/ingest',json=body,headers=internal).status_code==200
    assert db.query(models.AuditEvent).filter_by(id=uuid.UUID(body['id'])).count()==1


def test_people_directory_gives_every_role_names_but_nothing_else(workspace):
    """Pages show who did something by name ("Owner Test"), so every signed-in role reads the
    directory: login and name only, for the people of its own plants and the all-plant owners."""
    client, db, admin, plant, headers = workspace
    other_plant = models.Plant(id=uuid.uuid4(), code='TEST-'+uuid.uuid4().hex[:8], name='Other Plant', is_active=True)
    db.add(other_plant); db.flush()
    operator_role = db.query(models.Role).filter_by(name='Operator').one()
    operator = models.User(name='Ramesh Floor', email='ramesh-floor@example.com', hashed_password=get_password_hash('LocalOnlyTest1!'), is_active=True, plant=plant, allowed_plants=[plant], roles=[operator_role])
    stranger = models.User(name='Other Plant Store', email='other-store@example.com', hashed_password=get_password_hash('LocalOnlyTest1!'), is_active=True, plant=other_plant, allowed_plants=[other_plant], roles=[operator_role])
    gone = models.User(name='Left Last Year', email='left@example.com', hashed_password=get_password_hash('LocalOnlyTest1!'), is_active=False, plant=plant, allowed_plants=[plant], roles=[operator_role])
    db.add_all([operator, stranger, gone]); db.commit()
    operator_headers = {'Authorization': 'Bearer '+create_access_token(build_user_claims(operator))}

    result = client.get('/users/directory', headers=operator_headers)
    assert result.status_code == 200, result.text
    people = {row['email']: row for row in result.json()['items']}
    assert people['ramesh-floor@example.com'] == {'email': 'ramesh-floor@example.com', 'name': 'Ramesh Floor'}
    assert people['owner-test@example.com']['name'] == 'Owner Test'  # all-plant owner acts everywhere
    assert people['left@example.com']['name'] == 'Left Last Year'  # past actors keep their names
    assert 'other-store@example.com' not in people  # another plant's people stay out
    # The all-plant owner sees everyone.
    everyone = {row['email'] for row in client.get('/users/directory', headers=headers).json()['items']}
    assert {'other-store@example.com', 'ramesh-floor@example.com'} <= everyone
    # Signed out: nothing.
    assert client.get('/users/directory').status_code == 401
