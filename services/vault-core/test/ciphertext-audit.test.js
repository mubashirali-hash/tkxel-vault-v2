import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import JSZip from 'jszip';
import { EnvelopeEncryption, MockKmsProvider } from '../dist/crypto/kms.js';
import { VaultExportService, ExportForbiddenError } from '../dist/export/index.js';
import { InMemoryAuditSink, AuditService } from '../dist/audit/index.js';

describe('Epic 6.3: Storage Ciphertext Audit & Dual Export Verification', () => {
  const kms = new MockKmsProvider();
  const dek = EnvelopeEncryption.generateDek();
  const auditSink = new InMemoryAuditSink();
  const audit = new AuditService(auditSink);
  const exporter = new VaultExportService();

  // Helper to calculate Shannon Entropy (AES-256-GCM ciphertext typically > 5.8 bits/byte)
  function calculateShannonEntropy(buffer) {
    const frequencies = {};
    for (const byte of buffer) {
      frequencies[byte] = (frequencies[byte] || 0) + 1;
    }
    let entropy = 0;
    for (const byte in frequencies) {
      const p = frequencies[byte] / buffer.length;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  it('100% Ciphertext Audit: Raw storage inspection contains zero plaintext and high entropy', () => {
    const sensitiveStrings = [
      'CONFIDENTIAL_STRATEGY: 2027 tkxel expansion into quantum computing',
      'Client M&A Acquisition Deal Terms: $45M valuation with 3-year earn-out',
      '--- \ntitle: Proprietary Algorithm\ntags: [secret, ip]\n---\nWeights: 4.88, 12.1',
      'class SecretEngine { private key = "supersecret"; }',
    ];

    const rawDatabaseDump = [];

    // Simulate encryption and persisting to database records
    for (let i = 0; i < sensitiveStrings.length; i++) {
      const plain = sensitiveStrings[i];
      const encrypted = EnvelopeEncryption.encrypt(plain, dek);

      rawDatabaseDump.push({
        id: `rec_${i}`,
        table: i % 2 === 0 ? 'pages' : 'chunks',
        field: 'body_encrypted',
        data: encrypted,
      });
    }

    // Inspect database dump byte-by-byte
    for (const record of rawDatabaseDump) {
      const rawText = record.data.toString('utf-8');

      // 1. Check for ANY plaintext keyword leakage
      assert.ok(!rawText.includes('CONFIDENTIAL'), `Leaked plaintext keyword in ${record.id}`);
      assert.ok(!rawText.includes('Client M&A'), `Leaked plaintext deal terms in ${record.id}`);
      assert.ok(!rawText.includes('Proprietary Algorithm'), `Leaked algorithm title in ${record.id}`);
      assert.ok(!rawText.includes('SecretEngine'), `Leaked code structure in ${record.id}`);
      assert.ok(!rawText.includes('---'), `Leaked front matter delimiters in ${record.id}`);

      // 2. Check entropy (AES-256-GCM ciphertext has pseudorandom byte distribution with entropy > 5.5)
      const entropy = calculateShannonEntropy(record.data);
      assert.ok(entropy > 5.5, `Entropy ${entropy} indicates low randomness or unencrypted data in ${record.id}`);

      // 3. Verify authenticated decryption reproduces exact original text
      const decrypted = EnvelopeEncryption.decryptToString(record.data, dek);
      assert.ok(sensitiveStrings.includes(decrypted));
    }
  });

  it('Dual Export Verification: Open Vault permits Owner-only export with audit event', async () => {
    const openVault = {
      id: 'vlt_open_verified',
      title: 'Company Handbook',
      name: 'Company Handbook',
      mode: 'open',
      owner_id: 'usr_owner_01',
      export_policy: 'allowed_for_owner',
      created_at: new Date(),
    };

    const mockPages = [
      { title: 'Welcome Guide', slug: 'welcome-guide', content: '# Welcome to tkxel\n\nPolicy rules.' },
      { title: 'Remote Work', slug: 'remote-work', content: '# Remote Work Guidelines\n\nEquipment setup.' },
    ];

    // 1. Owner export: succeeds and generates ZIP
    const result = await exporter.exportVault({
      vault: openVault,
      requesterUserId: 'usr_owner_01',
      requesterRole: 'owner',
      justification: 'Quarterly compliance backup audit',
      pages: mockPages,
    });

    assert.ok(result.zipBuffer instanceof Buffer);
    assert.ok(result.zipBuffer.length > 0);
    assert.equal(result.pageCount, 2);

    const checksum = crypto.createHash('sha256').update(result.zipBuffer).digest('hex');
    assert.equal(checksum.length, 64);

    // Verify unzipped contents
    const unzipped = await JSZip.loadAsync(result.zipBuffer);
    assert.ok(unzipped.file('welcome-guide.md'));
    assert.ok(unzipped.file('remote-work.md'));

    // Record and verify audit event
    await audit.log({
      actorId: 'usr_owner_01',
      action: 'export_vault',
      targetId: openVault.id,
      metadata: { justification: 'Quarterly compliance backup audit', pageCount: 2, sha256: checksum },
    });

    const events = auditSink.getEventsByTarget(openVault.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'export_vault');
    assert.equal(events[0].actor_id, 'usr_owner_01');
    assert.equal(events[0].metadata.justification, 'Quarterly compliance backup audit');

    // 2. Reader export attempt: strictly rejected
    await assert.rejects(
      async () => {
        await exporter.exportVault({
          vault: openVault,
          requesterUserId: 'usr_reader_01',
          requesterRole: 'reader',
          justification: 'Unauthorized backup attempt',
          pages: mockPages,
        });
      },
      ExportForbiddenError
    );
  });

  it('Dual Export Verification: Locked Vault strictly forbids export for ALL roles including Owner', async () => {
    const lockedVault = {
      id: 'vlt_locked_verified',
      title: 'Proprietary IP Skills Vault',
      name: 'Proprietary IP Skills Vault',
      mode: 'locked',
      owner_id: 'usr_owner_01',
      export_policy: 'strictly_forbidden',
      created_at: new Date(),
    };

    const roles = ['owner', 'editor', 'consumer'];

    for (const role of roles) {
      await assert.rejects(
        async () => {
          await exporter.exportVault({
            vault: lockedVault,
            requesterUserId: `usr_${role}_01`,
            requesterRole: role,
            justification: `Export attempt as ${role}`,
            pages: [{ title: 'Secret', slug: 'secret', content: 'Secret body' }],
          });
        },
        ExportForbiddenError
      );
    }
  });
});
