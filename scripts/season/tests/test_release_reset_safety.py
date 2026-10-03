"""Offline release/recovery fault tests. Docker, AWS and systemd are fake tools.

The shell scripts themselves run unchanged apart from relocating /opt/hariom
into a temporary directory. Locks are real OS advisory locks on inherited FDs.
No database connection, AWS request or application process is made.
"""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
from unittest.mock import patch

import pytest


ROOT = Path(__file__).resolve().parents[3]
RESET_SPEC = importlib.util.spec_from_file_location("season_reset", ROOT / "scripts/season/reset_testing_data.py")
reset = importlib.util.module_from_spec(RESET_SPEC)
RESET_SPEC.loader.exec_module(reset)


@pytest.mark.parametrize("state", ["BACKING_UP", "RESETTING", "RESTORING", "RESTORE_FAILED", "RESTORED"])
def test_preview_cannot_replace_recovery_manifest(tmp_path, monkeypatch, state):
    monkeypatch.setenv("ERP_RELEASE_COMMIT", "a" * 40)
    identity = {"host": reset.db_url("authdb").host, "port": reset.db_url("authdb").port,
                "databases": {name: reset.db_url(name).database for name in reset.KEEP}}
    report = {"reset_id": "safe-reset-123", "status": state, "environment": identity,
              "release_commit": "a" * 40, "databases": {"proof": {"sha256": "retained", "cleared": True}}}
    manifest = tmp_path / "reset-manifest.json"
    manifest.write_text(json.dumps(report))
    before = manifest.read_bytes()
    args = argparse.Namespace(archive=str(tmp_path), reset_id="safe-reset-123", restore=False, apply=False, confirm="")
    with patch.object(reset, "create_engine", side_effect=AssertionError("must reject before database access")):
        with pytest.raises(RuntimeError, match="Recovery manifest cannot be replaced"):
            reset.run(args)
    assert manifest.read_bytes() == before


def test_empty_keep_set_rejects_unknown_analytics_table():
    with pytest.raises(RuntimeError, match="Unclassified tables in analyticsdb.*new_operational_table"):
        reset.classified_tables("analyticsdb", {"background_jobs", "new_operational_table"})
    assert reset.classified_tables("analyticsdb", {"background_jobs", "alembic_version"}) == (
        {"background_jobs"}, {"alembic_version"})
    assert reset.classified_tables("authdb", {"users", "security_history", "notifications"}) == (
        {"notifications"}, {"users", "security_history"})


def test_manifest_failed_replace_preserves_recovery_checkpoint(tmp_path):
    target = tmp_path / "reset-manifest.json"
    reset.write_manifest(target, {"status": "RESETTING", "sha256": "old-proof"})
    before = target.read_bytes()
    with patch.object(reset.os, "replace", side_effect=OSError("simulated rename failure")):
        with pytest.raises(OSError):
            reset.write_manifest(target, {"status": "RESTORING", "sha256": "new-proof"})
    assert target.read_bytes() == before
    assert target.stat().st_mode & 0o777 == 0o600


FAKE_TOOL = r'''#!PYTHON
import fcntl, hashlib, json, os, pathlib, shutil, subprocess, sys
name=pathlib.Path(sys.argv[0]).name;args=sys.argv[1:];root=pathlib.Path(os.environ['MOCK_ROOT'])
state_path=root/'tool-state.json';state=json.loads(state_path.read_text())
with (root/'calls.jsonl').open('a') as stream:stream.write(json.dumps([name,*args])+'\n')
def save():state_path.write_text(json.dumps(state))
def die(code=1):sys.exit(code)
if name=='flock':
    try:fcntl.flock(int(args[-1]),fcntl.LOCK_EX|fcntl.LOCK_NB)
    except (OSError,ValueError):die()
elif name=='readlink':
    try:
        actual=os.fstat(int(args[0].rsplit('/',1)[-1]));expected=os.stat(root/'opt/backups/backup.lock')
        if (actual.st_dev,actual.st_ino)==(expected.st_dev,expected.st_ino):print(root/'opt/backups/backup.lock')
        else:print('/another/backup.lock')
    except OSError:die()
elif name=='sleep':pass
elif name=='date':
    state['clock']=state.get('clock',0)+1;save();print('20261003T1100%02dZ'%state['clock'])
elif name=='systemctl':
    if args[0]=='is-active':die(0 if state['timers'].get(args[-1],False) else 3)
    if args[0] in ('start','stop'):
        for timer in args[1:]:state['timers'][timer]=args[0]=='start'
        save()
elif name=='install':pass
elif name=='pg_restore':pass
elif name=='sha256sum':
    if args==['--check','-']:
        for line in sys.stdin:
            checksum,path=line.rstrip('\n').split('  ',1)
            if hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()!=checksum:die()
    else:
        for path in args:print(hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()+'  '+path)
elif name=='curl':
    if '-o' in args:shutil.copyfile(root/'release.tar.gz',args[args.index('-o')+1])
    elif os.environ.get('MOCK_READY_FAIL')=='1':die()
    else:print('{"status":"ready"}')
elif name=='aws':
    if args[:2]==['s3','cp']:
        source,target=args[2:4]
        def object_path(url):return root/'s3'/url.split('/',3)[-1]
        if source.startswith('s3://'):source=object_path(source)
        if target.startswith('s3://'):target=object_path(target)
        target=pathlib.Path(target);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
    elif args[:2]==['s3api','list-objects-v2']:print('database/wrong-latest-object.tar.gz')
    elif os.environ.get('MOCK_METRICS_FAIL')=='1':die()
elif name=='docker':
    if args[0]=='inspect':
        fmt=args[args.index('--format')+1]
        if '.Config.Image' in fmt:print('hariom-erp-production-erp-app')
        elif '.Image' in fmt:print(state['image'])
        else:print('127.0.0.1')
    elif args[:2]==['image','tag']:
        state.setdefault('tags',{})[args[3]]=args[2];save()
    elif args[0]=='compose':
        action=next(x for x in args if x in ('ps','build','stop','start','up','exec'))
        i=args.index(action);tail=args[i+1:]
        if action=='ps':
            if '-q' in tail:print('mock-postgres' if tail[-1]=='postgres' else 'mock-erp')
            elif state['running']:print('erp-app')
        elif action=='build':
            if os.environ.get('MOCK_BUILD_COMPETITOR')=='1':
                result=subprocess.run(['bash',str(root/'opt/app/deploy/aws-ec2/backup_databases.sh')],
                                      close_fds=False,capture_output=True,text=True)
                (root/'competitor-result.json').write_text(json.dumps({'code':result.returncode,'output':result.stdout+result.stderr}))
                state=json.loads(state_path.read_text())
            if os.environ.get('MOCK_BUILD_FAIL')=='1':die(8)
            state.setdefault('tags',{})['hariom-erp-production-erp-app']='new-image';save()
        elif action=='stop':state['running']=False;save()
        elif action in ('up','start'):
            state['running']=True
            if action=='up':state['image']=state.get('tags',{}).get('hariom-erp-production-erp-app',state['image'])
            save()
        elif action=='exec':
            if 'pg_dump' in tail:print('offline-test-dump')
            elif 'psql' in tail:
                sql=sys.stdin.read()
                if 'count' in sql:print('public|fixture|1')
            elif 'curl' in tail:
                if not state['running'] or os.environ.get('MOCK_READY_FAIL')=='1':die()
                print('{"status":"ready"}')
    elif args[0]=='run':print('restore-container')
    elif args[0]=='exec' and 'psql' in args:
        if '-Atc' in args:print('1')
        else:sys.stdin.read();print('public|fixture|1')
elif name=='reset-python':
    sys.stdin.read();mode=os.environ['RESET_MODE']
    with (root/'reset-calls.jsonl').open('a') as stream:stream.write(mode+'\n')
    target=pathlib.Path(os.environ['RESET_ARCHIVE'])/'reset-manifest.json'
    if mode=='apply' and os.environ.get('MOCK_RESET_FAIL')=='1':
        target.write_text(json.dumps({'status':'RESETTING','proof':'preserve'}));die(9)
    if mode=='apply':target.write_text(json.dumps({'status':'COMPLETE','proof':'preserve'}))
    if mode=='restore':target.write_text(json.dumps({'status':'RESTORED','proof':'preserve'}))
else:raise RuntimeError('Unhandled fake tool '+name)
'''


@pytest.fixture
def shell_env(tmp_path):
    root = tmp_path
    opt = root / "opt"
    deploy = opt / "app/deploy/aws-ec2"
    deploy.mkdir(parents=True)
    (opt / "backups").mkdir()
    (opt / "DEPLOYED_COMMIT").write_text("a" * 40 + "\n")
    (deploy / ".env").write_text("DB_USER=test-only\nDB_PASSWORD=disposable-local-fixture\nBACKUP_S3_BUCKET=offline-fake\nSITE_HOST=test-only.invalid\n")
    (deploy / "docker-compose.yml").write_text("# no real Docker calls\n")
    (deploy / "backup_row_counts.sql").write_text("SELECT count(*) FROM fixture;\n")
    (root / "tool-state.json").write_text(json.dumps({"running": True, "image": "old-image",
        "timers": {"hariom-backup.timer": True, "hariom-restore-drill.timer": False}}))
    (root / "meminfo").write_text("MemTotal: 1000 kB\nMemAvailable: 500 kB\n")
    fakebin = root / "bin"
    fakebin.mkdir()
    executable = fakebin / "fake-tool"
    executable.write_text(FAKE_TOOL.replace("#!PYTHON", "#!" + str(Path(sys.executable).resolve())))
    executable.chmod(0o755)
    for tool in ("docker", "systemctl", "flock", "readlink", "curl", "aws", "install", "sleep", "date", "sha256sum", "pg_restore"):
        (fakebin / tool).symlink_to(executable)
    reset_bin = opt / "reset-venv/bin"
    reset_bin.mkdir(parents=True)
    (reset_bin / "python").symlink_to(executable)
    # Tool dispatch uses the symlink basename; keep reset Python distinct.
    executable_reset = reset_bin / "reset-python"
    executable_reset.symlink_to(executable)
    (reset_bin / "python").unlink()
    (reset_bin / "python").write_text('#!/usr/bin/env bash\nexec "' + str(executable_reset) + '" "$@"\n')
    (reset_bin / "python").chmod(0o755)
    reset_path = opt / "app/scripts/season/reset_testing_data.py"
    reset_path.parent.mkdir(parents=True)
    reset_path.write_text("# reviewed offline fake reset runner\n")
    for filename in ("release_verified.sh", "backup_databases.sh", "restore_drill.sh", "reset_testing_operations.sh", "publish_health_metrics.sh"):
        content = (ROOT / "deploy/aws-ec2" / filename).read_text().replace("/opt/hariom", str(opt)).replace("/proc/meminfo", str(root / "meminfo"))
        (deploy / filename).write_text(content)
    source = root / "source"
    shutil.copytree(deploy, source / "deploy/aws-ec2", ignore=shutil.ignore_patterns(".env"))
    migrations = source / "deploy/aws-ec2/migrations"
    migrations.mkdir()
    for name in ("20260910-production.sql", "20260928-procurement.sql"):
        (migrations / name).write_text("SELECT 1;\n")
    for name in ("hariom-backup.service", "hariom-health-metrics.service", "hariom-restore-drill.service"):
        (source / "deploy/aws-ec2" / name).write_text("# fake service\n")
    with tarfile.open(root / "release.tar.gz", "w:gz") as archive:
        archive.add(source, arcname="release")
    env = dict(os.environ, MOCK_ROOT=str(root), PATH=str(fakebin) + os.pathsep + os.environ["PATH"])
    return root, opt, deploy, env


def run_shell(script, args, env, **kwargs):
    return subprocess.run(["bash", str(script), *args], env=env, capture_output=True, text=True, timeout=30, **kwargs)


def read_calls(root):
    path = root / "calls.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def test_release_excludes_backup_during_build_and_restores_original_timers(shell_env):
    root, opt, deploy, env = shell_env
    env["MOCK_BUILD_COMPETITOR"] = "1"
    result = run_shell(deploy / "release_verified.sh", ["b" * 40, "a" * 40], env)
    assert result.returncode == 0, result.stdout + result.stderr
    competitor = json.loads((root / "competitor-result.json").read_text())
    assert competitor["code"] != 0 and "maintenance operation" in competitor["output"]
    state = json.loads((root / "tool-state.json").read_text())
    assert state["running"] and state["image"] == "new-image"
    assert state["timers"] == {"hariom-backup.timer": True, "hariom-restore-drill.timer": False}
    assert (opt / "DEPLOYED_COMMIT").read_text().strip() == "b" * 40
    work = next((opt / "releases").iterdir())
    assert json.loads((work / "maintenance-state.json").read_text())["phase"] == "RESUMED"
    assert not any(call[:3] == ["aws", "s3api", "list-objects-v2"] for call in read_calls(root))
    assert "Restore drill passed" in (work / "restore-result.txt").read_text()


def test_release_refuses_existing_backup_before_changing_source_or_timers(shell_env):
    root, opt, deploy, env = shell_env
    with (opt / "backups/backup.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        result = run_shell(deploy / "release_verified.sh", ["b" * 40, "a" * 40], env)
    assert result.returncode != 0 and "backup is already running" in result.stdout
    assert not (opt / "releases").exists()
    assert not any(call[0] in {"docker", "systemctl", "curl"} for call in read_calls(root))


def test_failed_build_restores_source_image_and_original_schedules(shell_env):
    root, opt, deploy, env = shell_env
    env["MOCK_BUILD_FAIL"] = "1"
    original = (deploy / "docker-compose.yml").read_bytes()
    result = run_shell(deploy / "release_verified.sh", ["b" * 40, "a" * 40], env)
    assert result.returncode == 8, result.stdout + result.stderr
    state = json.loads((root / "tool-state.json").read_text())
    assert state["running"] and state["image"] == "old-image"
    assert state["timers"] == {"hariom-backup.timer": True, "hariom-restore-drill.timer": False}
    assert (deploy / "docker-compose.yml").read_bytes() == original
    assert (opt / "DEPLOYED_COMMIT").read_text().strip() == "a" * 40


def test_failure_after_cutover_rolls_back_image_marker_and_schedules(shell_env):
    root, opt, deploy, env = shell_env
    env["MOCK_METRICS_FAIL"] = "1"
    result = run_shell(deploy / "release_verified.sh", ["b" * 40, "a" * 40], env)
    assert result.returncode != 0, result.stdout + result.stderr
    assert "running the previous image old-image" in result.stderr
    state = json.loads((root / "tool-state.json").read_text())
    assert state["running"] and state["image"] == "old-image"
    assert state["timers"] == {"hariom-backup.timer": True, "hariom-restore-drill.timer": False}
    assert (opt / "DEPLOYED_COMMIT").read_text().strip() == "a" * 40


def test_selected_restore_checksum_failure_stops_before_temporary_container(shell_env):
    root, opt, deploy, env = shell_env
    result = run_shell(deploy / "release_verified.sh", ["b" * 40, "a" * 40], env)
    assert result.returncode == 0, result.stdout + result.stderr
    work = next((opt / "releases").iterdir())
    backup = json.loads((work / "post-activation-backup.json").read_text())
    calls_before = len(read_calls(root))
    env.update(RESTORE_BACKUP_KEY=backup["s3_key"], RESTORE_ARCHIVE_SHA256="0" * 64)
    failed = run_shell(deploy / "restore_drill.sh", [], env)
    assert failed.returncode != 0 and "archive checksum differs" in failed.stderr
    assert not any(call[:2] == ["docker", "run"] for call in read_calls(root)[calls_before:])


@pytest.mark.parametrize("wrong_fd", [False, True])
def test_backup_rejects_missing_or_wrong_inherited_lock_before_runtime_stop(shell_env, wrong_fd):
    root, opt, deploy, env = shell_env
    env.update(ERP_BACKUP_LOCK_HELD="1", DEPLOY_DIR=str(deploy), BACKUP_ROOT=str(opt / "backups"))
    command = ["bash", str(deploy / "backup_databases.sh")]
    if wrong_fd:
        other = root / "another.lock"
        result = subprocess.run(["bash", "-c", 'exec 9>"$1"; bash "$2"', "test", str(other), str(command[1])],
                                env=env, capture_output=True, text=True, timeout=30)
    else:
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=30)
    assert result.returncode != 0 and "Inherited backup lock" in result.stderr
    assert not any(call[0] == "docker" for call in read_calls(root))


def test_reset_failure_then_restore_recovers_original_timer_states(shell_env):
    root, opt, deploy, env = shell_env
    env["MOCK_RESET_FAIL"] = "1"
    args = ["apply", "a" * 40, "recovery-test-123"]
    failed = run_shell(deploy / "reset_testing_operations.sh", args, env)
    assert failed.returncode == 9, failed.stdout + failed.stderr
    maintenance = opt / "testing-resets/recovery-test-123/maintenance-state.json"
    archived = json.loads(maintenance.read_text())
    assert archived["phase"] == "RECOVERY_REQUIRED"
    assert archived["backup_timer_active"] == 1 and archived["restore_timer_active"] == 0
    stopped = json.loads((root / "tool-state.json").read_text())
    assert not stopped["running"] and not any(stopped["timers"].values())
    env.pop("MOCK_RESET_FAIL")
    restored = run_shell(deploy / "reset_testing_operations.sh", ["restore", *args[1:]], env)
    assert restored.returncode == 0, restored.stdout + restored.stderr
    state = json.loads((root / "tool-state.json").read_text())
    assert state["running"]
    assert state["timers"] == {"hariom-backup.timer": True, "hariom-restore-drill.timer": False}
    assert json.loads(maintenance.read_text())["phase"] == "RESUMED"


def test_reset_readiness_failure_preserves_schedules_until_completed_retry(shell_env):
    root, opt, deploy, env = shell_env
    env["MOCK_READY_FAIL"] = "1"
    args = ["apply", "a" * 40, "readiness-test-123"]
    failed = run_shell(deploy / "reset_testing_operations.sh", args, env)
    assert failed.returncode != 0 and "readiness failed" in failed.stderr
    archive = opt / "testing-resets/readiness-test-123"
    assert json.loads((archive / "reset-manifest.json").read_text())["status"] == "COMPLETE"
    maintenance = archive / "maintenance-state.json"
    assert json.loads(maintenance.read_text())["phase"] == "RECOVERY_REQUIRED"
    stopped = json.loads((root / "tool-state.json").read_text())
    assert not stopped["running"] and not any(stopped["timers"].values())
    env.pop("MOCK_READY_FAIL")
    retry = run_shell(deploy / "reset_testing_operations.sh", args, env)
    assert retry.returncode == 0, retry.stdout + retry.stderr
    state = json.loads((root / "tool-state.json").read_text())
    assert state["running"] and state["timers"]["hariom-backup.timer"]
    assert not state["timers"]["hariom-restore-drill.timer"]
    assert json.loads(maintenance.read_text())["phase"] == "RESUMED"


def test_completed_reset_replay_does_not_stop_runtime_or_change_paused_schedule(shell_env):
    root, opt, deploy, env = shell_env
    args = ["apply", "a" * 40, "completed-test-123"]
    applied = run_shell(deploy / "reset_testing_operations.sh", args, env)
    assert applied.returncode == 0, applied.stdout + applied.stderr
    state_path = root / "tool-state.json"
    state = json.loads(state_path.read_text())
    state["timers"]["hariom-backup.timer"] = False
    state_path.write_text(json.dumps(state))
    calls_before = len(read_calls(root))
    replay = run_shell(deploy / "reset_testing_operations.sh", args, env)
    assert replay.returncode == 0, replay.stdout + replay.stderr
    calls = read_calls(root)[calls_before:]
    assert not any(call[0] == "systemctl" for call in calls)
    assert not any(call[0] == "docker" and "stop" in call for call in calls)
    assert json.loads(state_path.read_text())["timers"]["hariom-backup.timer"] is False


def test_reset_staged_override_requires_exact_checksum_before_shutdown(shell_env):
    root, opt, deploy, env = shell_env
    staged = opt / "reviewed-tools/reset.py"
    staged.parent.mkdir()
    staged.write_text("# reviewed staging runner\n")
    env.update(ERP_RESET_SCRIPT=str(staged), ERP_RESET_SCRIPT_SHA256="0" * 64)
    failed = run_shell(deploy / "reset_testing_operations.sh", ["preview", "a" * 40, "staged-test-123"], env)
    assert failed.returncode != 0 and "checksum differs" in failed.stderr
    assert not any(call[0] in {"docker", "systemctl"} for call in read_calls(root))
    env["ERP_RESET_SCRIPT_SHA256"] = __import__("hashlib").sha256(staged.read_bytes()).hexdigest()
    accepted = run_shell(deploy / "reset_testing_operations.sh", ["preview", "a" * 40, "staged-test-123"], env)
    assert accepted.returncode == 0, accepted.stdout + accepted.stderr
    assert not any(call[0] == "systemctl" and call[1] == "stop" for call in read_calls(root))


def test_reset_staged_override_rejects_parent_symlink_escape(shell_env):
    root, opt, deploy, env = shell_env
    external = root / "outside-reviewed-root"
    external.mkdir()
    script = external / "reset.py"
    script.write_text("# outside the permitted staging root\n")
    (opt / "linked-tools").symlink_to(external, target_is_directory=True)
    env.update(ERP_RESET_SCRIPT=str(opt / "linked-tools/reset.py"),
               ERP_RESET_SCRIPT_SHA256=__import__("hashlib").sha256(script.read_bytes()).hexdigest())
    result = run_shell(deploy / "reset_testing_operations.sh", ["preview", "a" * 40, "escaped-test-123"], env)
    assert result.returncode != 0 and "absolute" in result.stderr
    assert not any(call[0] in {"docker", "systemctl"} for call in read_calls(root))
