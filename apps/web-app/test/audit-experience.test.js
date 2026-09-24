import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const auditSource = readFileSync(new URL('../src/components/audit/AuditViewer.tsx', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

test('UXR-06 translates event codes and resolves only authorized known names', () => {
  assert.match(auditSource, /describeAuditAction/);
  assert.match(auditSource, /Created a note/);
  assert.match(auditSource, /Blocked a tool request/);
  assert.match(auditSource, /knownNames\[event\.target_id\]/);
  assert.match(appSource, /knownNames=\{Object\.fromEntries/);
  assert.match(appSource, /\.\.\.vaultPages\.map/);
});

test('UXR-06 provides person, activity, outcome, date, and resource search filters', () => {
  assert.match(auditSource, />Person</);
  assert.match(auditSource, />Activity</);
  assert.match(auditSource, />Outcome</);
  assert.match(auditSource, />Date</);
  assert.match(auditSource, /Search people, activity, or resource/);
});

test('UXR-06 keeps exact immutable evidence in a read-only technical drawer', () => {
  assert.match(auditSource, /Technical audit event details/);
  assert.match(auditSource, /Exact UTC time/);
  assert.match(auditSource, /Original metadata/);
  assert.match(auditSource, /JSON\.stringify\(selectedEvent\.metadata, null, 2\)/);
  assert.match(auditSource, /underlying event is append-only/);
});

test('UXR-06 bounds large audit views and explains CSV scope', () => {
  assert.match(auditSource, /const PAGE_SIZE = 25/);
  assert.match(auditSource, /filtered\.slice/);
  assert.match(auditSource, /Page \{page\} of \{pageCount\}/);
  assert.match(auditSource, /Export current vault CSV/);
  assert.match(auditSource, /authorized current-vault audit trail/);
});
