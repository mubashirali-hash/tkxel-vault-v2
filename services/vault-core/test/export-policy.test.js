import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  VaultExportService,
  ExportForbiddenError,
} from '../dist/export/index.js';

test('Export Policy: Open Vault permits export ONLY for Owner with valid package manifest', async () => {
  const service = new VaultExportService();
  const openVault = {
    id: 'vlt_open_1',
    name: 'Engineering Hub',
    mode: 'open',
    owner_id: 'usr_owner_1',
    data_key_id: 'kms_key_1',
    export_policy: 'allowed_for_owner',
    created_at: new Date(),
  };

  const pages = [
    { title: 'Home', slug: 'home', content: '# Home Page', frontmatter: { title: 'Home' } },
    { title: 'Roadmap', slug: 'roadmap', content: '## Q3 Roadmap' },
  ];

  // Owner export succeeds
  const exportResult = await service.exportVault({
    vault: openVault,
    requesterUserId: 'usr_owner_1',
    requesterRole: 'owner',
    pages,
    justification: 'Quarterly compliance backup',
  });

  assert.equal(exportResult.pageCount, 2);
  assert.equal(exportResult.vaultId, openVault.id);

  // Unpack zip to verify files
  const unzipped = await JSZip.loadAsync(exportResult.zipBuffer);
  assert.ok(unzipped.file('home.md'));
  assert.ok(unzipped.file('roadmap.md'));
  assert.ok(unzipped.file('tkxel-vault-export-manifest.json'));

  const manifestStr = await unzipped.file('tkxel-vault-export-manifest.json').async('string');
  const manifest = JSON.parse(manifestStr);
  assert.equal(manifest.vaultId, openVault.id);
  assert.equal(manifest.exportedBy, 'usr_owner_1');
  assert.equal(manifest.justification, 'Quarterly compliance backup');
});

test('Export Policy: Open Vault denies export for Editor and Reader roles', async () => {
  const service = new VaultExportService();
  const openVault = {
    id: 'vlt_open_2',
    name: 'General Wiki',
    mode: 'open',
    owner_id: 'usr_owner_1',
    data_key_id: 'kms_key_2',
    export_policy: 'allowed_for_owner',
    created_at: new Date(),
  };

  await assert.rejects(
    async () => {
      await service.exportVault({
        vault: openVault,
        requesterUserId: 'usr_editor_1',
        requesterRole: 'editor',
        pages: [],
      });
    },
    (err) => {
      assert.ok(err instanceof ExportForbiddenError);
      assert.match(err.message, /Only Vault Owners can export open vaults/);
      return true;
    }
  );

  await assert.rejects(
    async () => {
      await service.exportVault({
        vault: openVault,
        requesterUserId: 'usr_reader_1',
        requesterRole: 'reader',
        pages: [],
      });
    },
    ExportForbiddenError
  );
});

test('Export Policy: Locked Vault strictly denies export for ALL roles, including Owner', async () => {
  const service = new VaultExportService();
  const lockedVault = {
    id: 'vlt_locked_1',
    name: 'Proprietary IP Vault',
    mode: 'locked',
    owner_id: 'usr_owner_1',
    data_key_id: 'kms_key_locked',
    export_policy: 'strictly_forbidden',
    created_at: new Date(),
  };

  // Attempt export as Owner -> Must fail
  await assert.rejects(
    async () => {
      await service.exportVault({
        vault: lockedVault,
        requesterUserId: 'usr_owner_1',
        requesterRole: 'owner',
        pages: [{ title: 'Secret', slug: 'secret', content: 'Secret IP' }],
      });
    },
    (err) => {
      assert.ok(err instanceof ExportForbiddenError);
      assert.match(err.message, /Locked vault 'vlt_locked_1' cannot be exported by any role/);
      return true;
    }
  );

  // Attempt export as Consumer -> Must fail
  await assert.rejects(
    async () => {
      await service.exportVault({
        vault: lockedVault,
        requesterUserId: 'usr_consumer_1',
        requesterRole: 'consumer',
        pages: [],
      });
    },
    ExportForbiddenError
  );
});
