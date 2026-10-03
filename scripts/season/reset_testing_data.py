#!/usr/bin/env python3
"""Offline, archived reset of testing operations. Dry-run by default.

Run in an environment with the application's DB_* settings after stopping all
application services. Unknown tables fail closed. Credentials never enter output.
"""
import argparse
from datetime import datetime, timezone
import errno
import hashlib
import getpass
import json
import os
from pathlib import Path
import shutil
import subprocess
import uuid
from sqlalchemy import create_engine, text
from sqlalchemy.engine import URL

KEEP={
 "authdb":None,
 "masterdb":set("adhesive_master customer customer_contact employee machine machine_supported_mandrel mandrel packaging_box packaging_fadda packaging_plastic_sheet paper_master parchment_color parchment_vendor plant_holiday reason_code shift_definition supplier supplier_contact tool_attribute_option tool_master tube_size".split()),
 "specdb":set("global_spec_defaults spec_dynamic_fields production_season_state season_qc_rule_versions production_season_events".split()),
 "salesdb":set("sales_order_number_counters".split()),
 "productiondb":set("job_card_number_counters machine_stage_capacity_profile plant_tolerance_setting qc_instruments".split()),
 "inventorydb":set("document_series inventory_locations inventory_quality_templates item_master stock_alert_policies".split()),
 "analyticsdb":set(),
}
CLEAR={
 "authdb":set("notifications notification_delivery_log".split()),
 "masterdb":set("audit_outbox tool_usage_log".split()),
 "specdb":set("audit_outbox recipe_header recipe_layers season_command_receipts season_qc_overlay_versions season_release_authorizations season_spec_readiness spec_dynamic_field_values spec_save_operations spec_season_recipe_bindings specification_sheet trial_results".split()),
 "salesdb":set("audit_outbox sales_order_delivery_schedules sales_order_dispatch_logs sales_order_line_colors sales_order_lines sales_order_release_lots sales_order_schedule_allocations sales_orders".split()),
 "productiondb":set("audit_events audit_outbox continuous_command_receipts continuous_completion_outbox continuous_entry_revisions continuous_input_allocations continuous_residual_wip continuous_stage_entries dispatch dispatch_idempotency job_card_short_close job_card_stage_segments job_card_stages job_cards machine_downtime monthly_material_actuals monthly_material_close monthly_material_provisionals packing_records production_job quality_holds quality_inspections reel_issues sales_orders shift_material_ledger stage_queue_order".split()),
 "inventorydb":set("audit_outbox customer_rejections inventory_carry_forward_lines inventory_carry_forwards inventory_certification_lines inventory_certifications inventory_opening_load_lines inventory_opening_loads inventory_quality_concessions inventory_quality_holds inventory_quality_inspections label_print_jobs lot_label_records mrp_runs paper_reels procurement_plan_conversions procurement_plan_entries procurement_plans purchase_approval_decisions purchase_debit_note_lines purchase_debit_note_settlements purchase_debit_notes purchase_discrepancies purchase_line_schedules purchase_order_lines purchase_order_revision_lines purchase_order_revisions purchase_orders purchase_receipt_lines purchase_receipts purchase_requisitions purchase_workbook_imports receipt_invoice_allocations receipt_schedule_allocations receipt_stock_allocations reel_issues reel_scan_events reservations rm_cost_components rm_cost_sheets rm_cost_versions stock_adjustment_lines stock_adjustment_vouchers stock_alert_episodes stock_batch stock_transaction supplier_invoice_lines supplier_invoices tool_asset_assignments tool_asset_events tool_assets tool_receipts".split()),
 "analyticsdb":set("background_jobs".split()),
}


def db_url(name):
    return URL.create("postgresql+psycopg2",username=os.getenv("DB_USER",os.getenv("USER","postgres")),password=os.getenv("DB_PASSWORD") or None,host=os.getenv("DB_HOST","127.0.0.1"),port=int(os.getenv("DB_PORT","5432")),database=os.getenv("ERP_DB_PREFIX","")+name)


def write_manifest(path, report):
    """A killed writer must leave the previous recovery checkpoint readable."""
    temporary=path.with_name(path.name+'.tmp')
    with temporary.open('w') as stream:
        os.chmod(temporary,0o600)
        json.dump(report,stream,indent=2);stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,path)
    directory=os.open(path.parent,os.O_RDONLY)
    try:
        try:os.fsync(directory)
        except OSError as exc:
            if exc.errno not in (errno.EINVAL,errno.ENOTSUP):raise
    finally:os.close(directory)


def classified_tables(name, tables):
    # None deliberately retains the entire authentication/security catalogue.
    # An empty set means no retained tables, not permission to retain anything.
    known=(tables if KEEP[name] is None else KEEP[name])|CLEAR[name]|{'alembic_version'}
    unknown=tables-known
    if unknown:raise RuntimeError(f"Unclassified tables in {name}: {sorted(unknown)}")
    clear=tables&CLEAR[name]
    return clear,tables-clear


def pg_tool(name,url,args):
    container=os.getenv('ERP_PG_CONTAINER')
    if container:
        # Use the deployed PostgreSQL image's matching client version. Dumps
        # stream to the host archive; no extra DB credentials are printed.
        command=['docker','exec','-i',container,name,'--username',url.username]
        if name=='pg_dump':
            position=args.index('--file');target=Path(args[position+1]);remaining=args[:position]+args[position+2:]
            with target.open('wb') as stream:result=subprocess.run([*command,'--dbname',url.database,*remaining],stdout=stream,stderr=subprocess.PIPE)
        else:
            with Path(args[-1]).open('rb') as stream:result=subprocess.run([*command,'--dbname',url.database,*args[:-1]],stdin=stream,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
        if result.returncode:raise RuntimeError(f'{name} failed; archive preserved. Exit {result.returncode}')
        return
    tool=shutil.which(name) or str(Path('/opt/homebrew/opt/postgresql@16/bin')/name)
    env=dict(os.environ);env.update(PGHOST=url.host,PGPORT=str(url.port),PGUSER=url.username,PGDATABASE=url.database)
    if url.password:env['PGPASSWORD']=url.password
    target=['--dbname',url.database] if name=='pg_restore' else []
    result=subprocess.run([tool,*target,*args],env=env,capture_output=True,text=True)
    if result.returncode:raise RuntimeError(f"{name} failed; archive preserved. Exit {result.returncode}")


def counts(engine,tables):
    with engine.connect() as c:return {t:c.execute(text('SELECT count(*) FROM "'+t+'"')).scalar() for t in sorted(tables)}


def content_hashes(engine,tables):
    with engine.connect() as c:
        return {t:c.execute(text('SELECT md5(COALESCE(string_agg(row_hash,\'\' ORDER BY row_hash),\'\')) FROM (SELECT md5(to_jsonb(row)::text) AS row_hash FROM "'+t+'" row) hashes')).scalar() for t in sorted(tables)}


def restore_backup(args,output,report,identity):
    if not report or report.get('reset_id')!=args.reset_id or report.get('environment')!=identity:raise RuntimeError('Matching archived reset manifest required for recovery')
    if args.confirm!='RESTORE ALL SEVEN DATABASES FROM THIS BACKUP':raise RuntimeError('Exact seven-database recovery confirmation required')
    engines={}
    # Validate EVERY dump and offline database before restoring the first one.
    for name in KEEP:
        data=report['databases'][name];dump=output/(name+'.dump')
        if not data.get('restore_verified') or not dump.is_file() or hashlib.file_digest(dump.open('rb'),'sha256').hexdigest()!=data.get('sha256'):raise RuntimeError('Missing or changed verified backup: '+name)
        engine=create_engine(db_url(name));engines[name]=engine
        with engine.connect() as c:
            if c.execute(text("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")).scalar():raise RuntimeError('Database clients still connected to '+name)
    report['status']='RESTORING';write_manifest(output/'reset-manifest.json',report)
    try:
        for name,engine in engines.items():
            engine.dispose()
            pg_tool('pg_restore',db_url(name),['--clean','--if-exists','--single-transaction','--exit-on-error','--no-owner','--no-acl',str(output/(name+'.dump'))])
            data=report['databases'][name]
            if counts(engine,data['before'])!=data['before'] or content_hashes(engine,data['before'])!=data['content_hashes']:raise RuntimeError('Restored database differs from archived content: '+name)
            data['recovered']=True;write_manifest(output/'reset-manifest.json',report)
    except Exception:
        report['status']='RESTORE_FAILED';write_manifest(output/'reset-manifest.json',report);raise
    report['status']='RESTORED';report['restored_at']=datetime.now(timezone.utc).isoformat();write_manifest(output/'reset-manifest.json',report)
    print('All seven databases recovered and their archived counts/content verified')


def run(args):
    output=Path(args.archive).resolve();output.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(output,0o700)
    report_path=output/'reset-manifest.json'
    identity={'host':db_url('authdb').host,'port':db_url('authdb').port,'databases':{name:db_url(name).database for name in KEEP}}
    existing=None
    if report_path.exists():
        existing=json.loads(report_path.read_text())
    if args.restore:
        restore_backup(args,output,existing,identity);return
    if existing:
        if existing['reset_id']!=args.reset_id:raise RuntimeError("Archive directory belongs to a different reset")
        if existing.get('environment')!=identity:raise RuntimeError('Reset environment differs from the reviewed manifest')
        if existing.get('release_commit')!=os.getenv('ERP_RELEASE_COMMIT'):raise RuntimeError('Release differs from the reviewed reset manifest')
        if existing.get('status')=='COMPLETE':print("Reset already complete; no records deleted again");return
        if not args.apply and existing.get('status')!='PREVIEW':raise RuntimeError('Recovery manifest cannot be replaced by a preview; use a fresh archive and reset ID')
        if args.apply and existing.get('status')!='PREVIEW':raise RuntimeError("An incomplete reset needs reviewed recovery from this manifest before rerun")
    if args.apply and not existing:raise RuntimeError('Create and review a dry-run manifest before applying the reset')
    report={'reset_id':args.reset_id,'scope':'testing operations across both plants','environment':identity,'release_commit':os.getenv('ERP_RELEASE_COMMIT'),'operator':os.getenv('ERP_RESET_ACTOR') or getpass.getuser(),'created_at':datetime.now(timezone.utc).isoformat(),'status':'PREVIEW','databases':{}}
    engines={}
    for name in KEEP:
        url=db_url(name);engine=create_engine(url);engines[name]=engine
        with engine.connect() as c:
            tables=set(c.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public'")).scalars())
            clear,keep=classified_tables(name,tables)
            # App connections (including idle pools) must be gone before backups.
            if args.apply and c.execute(text("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND backend_type='client backend'")).scalar():raise RuntimeError(f"Application/database clients still connected to {name}; stop services first")
        with engine.connect() as c:
            references=c.execute(text("SELECT source.relname,target.relname FROM pg_constraint f JOIN pg_class source ON source.oid=f.conrelid JOIN pg_class target ON target.oid=f.confrelid WHERE f.contype='f' AND source.relnamespace='public'::regnamespace AND target.relnamespace='public'::regnamespace")).all()
            conflicts=[(source,target) for source,target in references if source in keep and target in clear]
            if conflicts:raise RuntimeError(f'Retained tables reference the reset scope in {name}: {conflicts}; classify dependencies explicitly')
        report['databases'][name]={'clear':sorted(clear),'keep':sorted(keep),'before':counts(engine,tables),'content_hashes':content_hashes(engine,tables)}
    if args.apply and existing and any(existing['databases'][name]!=report['databases'][name] for name in KEEP):raise RuntimeError('Data changed since the reviewed preview; create and review a fresh preview while the runtime is stopped')
    review_basis={key:report[key] for key in ('environment','release_commit','databases')}
    report['review_fingerprint']=hashlib.sha256(json.dumps(review_basis,sort_keys=True,separators=(',',':')).encode()).hexdigest()
    print(json.dumps({name:{'clear_tables':len(r['clear']),'rows':sum(r['before'][t] for t in r['clear']),'kept_tables':len(r['keep'])} for name,r in report['databases'].items()},indent=2))
    print('REVIEW_FINGERPRINT='+report['review_fingerprint'])
    if not args.apply:write_manifest(report_path,report);return
    if args.confirm!='ALL CURRENT OPERATIONS ARE TEST DATA':raise RuntimeError("Exact testing-data confirmation required")
    reviewed=output/'reviewed-preview.json'
    write_manifest(reviewed,existing)
    report['status']='BACKING_UP';write_manifest(report_path,report)
    # All databases get checksum and actual restore/count verification BEFORE deletion.
    for name,engine in engines.items():
        url=db_url(name);dump=output/(name+'.dump');pg_tool('pg_dump',url,['--format=custom','--no-owner','--no-acl','--file',str(dump)])
        os.chmod(dump,0o600)
        report['databases'][name]['sha256']=hashlib.file_digest(dump.open('rb'),'sha256').hexdigest()
        restore_name='hariom_reset_verify_'+uuid.uuid4().hex[:16]
        admin=create_engine(url.set(database='postgres'),isolation_level='AUTOCOMMIT')
        with admin.connect() as c:c.execute(text('CREATE DATABASE "'+restore_name+'"'))
        restored=create_engine(url.set(database=restore_name))
        try:
            pg_tool('pg_restore',url.set(database=restore_name),['--exit-on-error','--no-owner','--no-acl',str(dump)])
            actual=counts(restored,report['databases'][name]['before'])
            if actual!=report['databases'][name]['before'] or content_hashes(restored,actual)!=report['databases'][name]['content_hashes']:raise RuntimeError('Backup restore counts/content do not match '+name)
            report['databases'][name]['restore_verified']=True
        finally:
            restored.dispose()
            with admin.connect() as c:c.execute(text('DROP DATABASE "'+restore_name+'" WITH (FORCE)'))
            admin.dispose()
        write_manifest(report_path,report)
    report['status']='RESETTING';write_manifest(report_path,report)
    for name,engine in engines.items():
        data=report['databases'][name]
        if data['clear']:
            with engine.begin() as c:
                # No CASCADE: a retained table dependency must halt the reset.
                c.execute(text('TRUNCATE '+','.join('"'+t+'"' for t in data['clear'])+' RESTART IDENTITY'))
        after=counts(engine,data['before'])
        if any(after[t] for t in data['clear']):raise RuntimeError('Reset count mismatch '+name)
        if any(after[t]!=data['before'][t] for t in data['keep']) or content_hashes(engine,data['keep'])!={t:data['content_hashes'][t] for t in data['keep']}:raise RuntimeError('Retained configuration changed '+name)
        data['after']=after;data['cleared']=True;write_manifest(report_path,report)
    report['status']='COMPLETE';report['completed_at']=datetime.now(timezone.utc).isoformat();write_manifest(report_path,report)
    print('Testing operations reset complete; all backups restored and retained counts verified')

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--archive',required=True);parser.add_argument('--reset-id',required=True);modes=parser.add_mutually_exclusive_group();modes.add_argument('--apply',action='store_true');modes.add_argument('--restore',action='store_true');parser.add_argument('--confirm',default='');run(parser.parse_args())
