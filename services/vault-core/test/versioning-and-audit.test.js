import test from 'node:test';
import assert from 'node:assert/strict';
import { VersioningService } from '../dist/versioning/index.js';
import { AuditService, InMemoryAuditSink } from '../dist/audit/index.js';

test('Versioning: publish and rollback state transitions', () => {
  const service = new VersioningService();

  const page = {
    id: 'pg_01',
    vault_id: 'vlt_01',
    type: 'note',
    title: 'Architecture Overview',
    aliases: [],
    tags: ['infra'],
    front_matter: {},
    current_version_id: null,
    created_at: new Date(),
  };

  const v1Blob = Buffer.from('Initial draft content');
  const v1 = service.publishVersion(page, v1Blob, 0, 'usr_author_1');

  assert.equal(v1.newVersion.number, 1);
  assert.equal(v1.page.current_version_id, v1.newVersion.id);

  const v2Blob = Buffer.from('Updated second revision');
  const v2 = service.publishVersion(v1.page, v2Blob, 1, 'usr_author_1');
  assert.equal(v2.newVersion.number, 2);

  // Rollback to v1
  const rollback = service.rollbackToVersion(v2.page, v1.newVersion, 2, 'usr_author_1');
  assert.equal(rollback.newVersion.number, 3);
  assert.equal(rollback.newVersion.encrypted_blob.toString(), v1Blob.toString());
});

test('Versioning: computes accurate line-by-line diffs', () => {
  const service = new VersioningService();
  const oldText = 'Line 1\nLine 2\nLine 3';
  const newText = 'Line 1\nLine 2 modified\nLine 3\nLine 4';

  const diff = service.computeLineDiff(oldText, newText);
  assert.ok(diff.some((d) => d.type === 'unchanged' && d.line === 'Line 1'));
  assert.ok(diff.some((d) => d.type === 'added' && d.line === 'Line 4'));
});

test('Audit Service: append-only log and target retrieval', async () => {
  const sink = new InMemoryAuditSink();
  const audit = new AuditService(sink);

  await audit.log({
    actorId: 'usr_admin',
    action: 'export_open_vault',
    targetId: 'vlt_open_1',
    metadata: { reason: 'backup' },
  });

  await audit.log({
    actorId: 'usr_attacker',
    action: 'export_locked_denied',
    targetId: 'vlt_locked_1',
    metadata: { violation: 'forbidden_export' },
  });

  const events = sink.getEventsByTarget('vlt_locked_1');
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'export_locked_denied');
  assert.equal(events[0].actor_id, 'usr_attacker');
});
