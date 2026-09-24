import { register } from 'node:module';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

register(new URL('./helpers/tsx-loader.js', import.meta.url).href, import.meta.url);

const {
  createVaultApi,
  deleteVaultApi,
  movePageApi,
  applyPageSave,
  savePageContentApi,
  applyAiContentTransform,
  insertWikiLink,
  resolveOutgoingLinks,
  processImportPages,
  buildExportZipPackage,
  serializePageToMarkdown,
  createSafeExportFilename,
} = await import('../src/operations/index.js');

const { adaptLegacyImportPage, adaptLegacyImportPages } = await import(
  '../src/utils/legacy-import-adapter.js'
);

describe('Production Operations: Vault Actions API', () => {
  test('createVaultApi: creates vault and parses response on HTTP 200', async () => {
    const mockFetch = async (url, options) => {
      assert.equal(url, 'http://localhost:3002/api/vaults');
      assert.equal(options.method, 'POST');
      assert.equal(options.headers['Authorization'], 'Bearer sso-token-123');
      const body = JSON.parse(options.body);
      assert.equal(body.name, 'Confidential Research');
      assert.equal(body.mode, 'locked');

      return {
        ok: true,
        status: 200,
        json: async () => ({
          vault: {
            id: 'vault-new-01',
            name: 'Confidential Research',
            mode: 'locked',
            owner_id: 'user-01',
            data_key_id: 'kms-key-01',
            export_policy: 'disabled',
            created_at: '2026-09-17T12:00:00.000Z',
          },
        }),
      };
    };

    const vault = await createVaultApi(
      { name: 'Confidential Research', mode: 'locked', export_policy: 'disabled' },
      { token: 'sso-token-123', fetchImpl: mockFetch }
    );

    assert.equal(vault.id, 'vault-new-01');
    assert.equal(vault.name, 'Confidential Research');
    assert.equal(vault.mode, 'locked');
    assert.ok(vault.created_at instanceof Date);
  });

  test('createVaultApi: throws descriptive error on server failure', async () => {
    const failingFetch = async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'KMS HSM unavailable' }),
    });

    await assert.rejects(
      () =>
        createVaultApi(
          { name: 'Broken Vault', mode: 'open' },
          { fetchImpl: failingFetch }
        ),
      /KMS HSM unavailable/
    );
  });

  test('movePageApi: dispatches move request and throws on server error', async () => {
    let requestedUrl = '';
    let requestBody = null;

    const mockFetch = async (url, options) => {
      requestedUrl = url;
      requestBody = JSON.parse(options.body);
      return { ok: true, status: 200 };
    };

    await movePageApi('page-101', 'dest-vault-02', {
      token: 'token-abc',
      fetchImpl: mockFetch,
    });

    assert.equal(requestedUrl, 'http://localhost:3002/api/pages/page-101/move');
    assert.equal(requestBody.destination_vault_id, 'dest-vault-02');

    // Test rejection on 403
    const forbiddenFetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Permission denied: cannot move to destination vault' }),
    });

    await assert.rejects(
      () => movePageApi('page-101', 'dest-vault-02', { fetchImpl: forbiddenFetch }),
      /Permission denied/
    );
  });

  test('deleteVaultApi: dispatches DELETE request with authorization and throws on error', async () => {
    let requestedUrl = '';
    let requestedMethod = '';
    let authHeader = '';

    const mockFetch = async (url, options) => {
      requestedUrl = url;
      requestedMethod = options.method;
      authHeader = options.headers?.['Authorization'];
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    };

    await deleteVaultApi('vault-to-delete-01', {
      token: 'token-xyz',
      fetchImpl: mockFetch,
    });

    assert.equal(requestedUrl, 'http://localhost:3002/api/vaults/vault-to-delete-01');
    assert.equal(requestedMethod, 'DELETE');
    assert.equal(authHeader, 'Bearer token-xyz');

    const failingFetch = async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden: only owner can delete vault' }),
    });

    await assert.rejects(
      () => deleteVaultApi('vault-to-delete-01', { fetchImpl: failingFetch }),
      /Forbidden: only owner can delete vault/
    );
  });
});

describe('Production Operations: Page Save & Wiki-Link Refactoring', () => {
  test('applyPageSave: updates active page content and scrubs front_matter.body', () => {
    const initialPages = [
      {
        id: 'p1',
        vault_id: 'v1',
        title: 'Security Architecture',
        type: 'note',
        tags: ['security'],
        content: '# Old Content',
        front_matter: { title: 'Security Architecture', body: 'Stale body', tags: ['security'] },
      },
    ];

    const result = applyPageSave({
      pages: initialPages,
      activePage: initialPages[0],
      updated: {
        title: 'Security Architecture',
        content: '# Updated Security Architecture\n\nNew verified body with [[KMS Key]].',
        tags: ['security', 'kms'],
        type: 'decision',
      },
    });

    assert.equal(result.renamed, false);
    assert.equal(result.updatedPages.length, 1);
    const updatedPage = result.updatedPages[0];
    assert.equal(updatedPage.content, '# Updated Security Architecture\n\nNew verified body with [[KMS Key]].');
    assert.equal(updatedPage.front_matter.body, undefined, 'front_matter.body must be scrubbed');
    assert.equal(updatedPage.type, 'decision');
    assert.deepEqual(updatedPage.tags, ['security', 'kms']);
  });

  test('applyPageSave: refactors wiki-links across other pages when page is renamed', () => {
    const page1 = {
      id: 'p1',
      vault_id: 'v1',
      title: 'Old Title',
      type: 'note',
      tags: [],
      content: '# Old Note',
      front_matter: { title: 'Old Title' },
    };
    const page2 = {
      id: 'p2',
      vault_id: 'v1',
      title: 'Referring Note',
      type: 'note',
      tags: [],
      content: 'References [[Old Title]] for details.',
      front_matter: { title: 'Referring Note' },
    };

    const result = applyPageSave({
      pages: [page1, page2],
      activePage: page1,
      updated: {
        title: 'New Refactored Title',
        content: '# Old Note renamed',
        tags: [],
        type: 'note',
      },
    });

    assert.equal(result.renamed, true);
    assert.equal(result.oldTitle, 'Old Title');
    assert.equal(result.newTitle, 'New Refactored Title');

    const updatedReferring = result.updatedPages.find((p) => p.id === 'p2');
    assert.ok(updatedReferring.content.includes('[[New Refactored Title]]'));
    assert.equal(updatedReferring.front_matter.body, undefined);
  });

  test('savePageContentApi: calls draft or publish endpoint with OCC timestamp and auth token', async () => {
    let endpointCalled = '';
    let payloadSent = null;

    const mockFetch = async (url, options) => {
      endpointCalled = url;
      payloadSent = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ updated_at: '2026-09-17T12:05:00.000Z' }),
      };
    };

    // Test Draft
    const resDraft = await savePageContentApi(
      'page-draft-1',
      { content: '# Draft Body', vault_id: 'v1', updated_at: '2026-09-17T12:00:00.000Z' },
      true,
      { token: 'tok-123', fetchImpl: mockFetch }
    );
    assert.ok(resDraft.ok);
    assert.equal(endpointCalled, 'http://localhost:3002/api/pages/page-draft-1/draft');
    assert.equal(payloadSent.content, '# Draft Body');

    // Test Publish
    const resPublish = await savePageContentApi(
      'page-draft-1',
      { content: '# Published Body', vault_id: 'v1' },
      false,
      { token: 'tok-123', fetchImpl: mockFetch }
    );
    assert.ok(resPublish.ok);
    assert.equal(endpointCalled, 'http://localhost:3002/api/pages/page-draft-1/publish');
  });
});

describe('Production Operations: AI Transforms and Wiki-Link Insertion', () => {
  const basePage = {
    id: 'p-ai-1',
    vault_id: 'v1',
    title: 'AI Note',
    type: 'note',
    tags: [],
    content: '# Core Content\n\nOriginal paragraph.',
    front_matter: { title: 'AI Note', body: 'stale' },
  };

  test('applyAiContentTransform: Replace mode replaces content and scrubs front_matter.body', () => {
    const result = applyAiContentTransform(basePage, 'replace', '# Replacement Content');
    assert.equal(result.content, '# Replacement Content');
    assert.equal(result.front_matter.body, undefined);
  });

  test('applyAiContentTransform: Append mode appends to content and scrubs front_matter.body', () => {
    const result = applyAiContentTransform(basePage, 'append', '## Additional Section');
    assert.ok(result.content.includes('# Core Content\n\nOriginal paragraph.'));
    assert.ok(result.content.includes('## Additional Section'));
    assert.equal(result.front_matter.body, undefined);
  });

  test('applyAiContentTransform: Insert mode prepends content and scrubs front_matter.body', () => {
    const result = applyAiContentTransform(basePage, 'insert', '<!-- Header Notice -->');
    assert.ok(result.content.startsWith('<!-- Header Notice -->'));
    assert.equal(result.front_matter.body, undefined);
  });

  test('insertWikiLink: appends link to Page.content and avoids duplicate links', () => {
    const targetTitle = 'KMS Protocol';
    const linked = insertWikiLink(basePage, targetTitle);
    assert.ok(linked.content.includes('- [[KMS Protocol]]'));
    assert.equal(linked.front_matter.body, undefined);

    // Idempotent: linking again does not create redundant line
    const secondLinked = insertWikiLink(linked, targetTitle);
    assert.equal(secondLinked.content, linked.content);
  });

  test('resolveOutgoingLinks: extracts links from Page.content matching known page titles and aliases', () => {
    const allPages = [
      { id: 'p1', title: 'Source', aliases: [] },
      { id: 'p2', title: 'Target Note', aliases: ['Target Alias'] },
      { id: 'p3', title: 'Other Note', aliases: ['Special Alias'] },
    ];

    const content = 'Links to [[Target Note]] and [[Special Alias]].';
    const outgoing = resolveOutgoingLinks('p1', content, allPages);

    assert.equal(outgoing.length, 2);
    assert.ok(outgoing.some((o) => o.to_page_id === 'p2'));
    assert.ok(outgoing.some((o) => o.to_page_id === 'p3'));
  });
});

describe('Production Operations: Import Pipeline and Legacy Adaptation', () => {
  test('adaptLegacyImportPage: migrates legacy front_matter.body to Page.content and scrubs body', () => {
    const legacyPage = {
      id: 'leg-1',
      title: 'Legacy Note',
      front_matter: { title: 'Legacy Note', body: '# Migrated Body\n\nRecovered content.' },
    };

    const adapted = adaptLegacyImportPage(legacyPage);
    assert.equal(adapted.content, '# Migrated Body\n\nRecovered content.');
    assert.equal(adapted.front_matter.body, undefined);
  });

  test('processImportPages: adapts pages, registers internal links, and updates combined inventory', () => {
    const importResult = {
      pages: [
        {
          title: 'Imported Alpha',
          folder: 'Specs',
          content: '# Alpha\n\nLinks to [[Imported Beta]] and [[Existing Page]].',
          parsed: {
            frontMatter: { type: 'architecture', tags: ['spec'] },
            tags: ['spec'],
          },
        },
        {
          title: 'Imported Beta',
          folder: 'Specs',
          content: '# Beta\n\nLeaf note.',
          parsed: {
            frontMatter: { type: 'note', tags: [] },
            tags: [],
          },
        },
      ],
      totalFilesProcessed: 2,
      totalWikiLinksFound: 2,
      totalTagsFound: 1,
      skippedFiles: [],
    };

    const existingPages = [
      { id: 'ex-1', title: 'Existing Page', content: '# Existing', front_matter: {} },
    ];

    const processed = processImportPages(importResult, 'vault-target-1', existingPages);
    assert.equal(processed.newPages.length, 2);
    assert.equal(processed.combinedPages.length, 3);

    // Verify imported links registered: Alpha -> Beta, Alpha -> Existing
    assert.equal(processed.importedLinks.length, 2);
    const alphaPage = processed.newPages.find((p) => p.title === 'Imported Alpha');
    const betaPage = processed.newPages.find((p) => p.title === 'Imported Beta');
    assert.ok(
      processed.importedLinks.some(
        (l) => l.from_page_id === alphaPage.id && l.to_page_id === betaPage.id
      )
    );
    assert.ok(
      processed.importedLinks.some(
        (l) => l.from_page_id === alphaPage.id && l.to_page_id === 'ex-1'
      )
    );
  });
});

describe('Production Operations: Markdown Export Packaging', () => {
  test('serializePageToMarkdown: generates valid Markdown with YAML header and Page.content body', () => {
    const page = {
      id: 'exp-1',
      title: 'Envelope Encryption Spec',
      type: 'decision',
      tags: ['security', 'kms'],
      aliases: ['ADR-005'],
      content: '# Envelope Encryption Spec\n\nDetailed cryptographic architecture.',
      created_at: new Date('2026-03-01T00:00:00.000Z'),
      front_matter: { title: 'Envelope Encryption Spec' },
    };

    const md = serializePageToMarkdown(page);
    assert.ok(md.startsWith('---\n'));
    assert.ok(md.includes('title: "Envelope Encryption Spec"'));
    assert.ok(md.includes('type: "decision"'));
    assert.ok(md.includes('# Envelope Encryption Spec\n\nDetailed cryptographic architecture.'));
  });

  test('buildExportZipPackage: packages vault notes into a zip archive with safe filenames', async () => {
    const pages = [
      {
        id: 'p-v1-1',
        vault_id: 'vault-active',
        title: 'Cloud KMS Architecture / 2026',
        content: '# Cloud KMS Architecture',
        tags: [],
        type: 'note',
        front_matter: {},
      },
      {
        id: 'p-v2-1',
        vault_id: 'vault-other',
        title: 'Unrelated Vault Note',
        content: '# Other',
        tags: [],
        type: 'note',
        front_matter: {},
      },
    ];

    const { zip, fileCount, files } = await buildExportZipPackage(pages, 'vault-active');
    assert.equal(fileCount, 1);
    const expectedFilename = createSafeExportFilename('Cloud KMS Architecture / 2026');
    assert.equal(expectedFilename, 'Cloud_KMS_Architecture___2026.md');
    assert.ok(files[expectedFilename]);
    assert.ok(files[expectedFilename].includes('# Cloud KMS Architecture'));
    assert.ok(zip.file(expectedFilename));
  });
});
