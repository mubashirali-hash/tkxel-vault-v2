import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { db } from '../dist/db.js';
import * as schema from '../dist/schema/index.js';
import { sql, inArray } from 'drizzle-orm';
import { searchPages } from '../dist/search/index.js';

test('Epic 5 Chunk 5.1: PostgreSQL Full-Text Lexical Ranking & Search Invariants', async (t) => {
  const ownerId = 'owner.lexical@test.com';

  // Vault IDs
  const vaultOpen1Id = crypto.randomUUID();
  const vaultOpen2Id = crypto.randomUUID();
  const vaultLockedId = crypto.randomUUID();

  // Temporarily clear OPENAI_API_KEY to ensure no hosted provider is reachable
  const originalOpenAiKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;

  // Page IDs
  const pageHighDensityId = crypto.randomUUID();
  const pageLowDensityId = crypto.randomUUID();
  const pageTitleMatchId = crypto.randomUUID();
  const pageTitleControlId = crypto.randomUUID();
  const pageTagMatchId = crypto.randomUUID();
  const pageTagControlId = crypto.randomUUID();
  const pagePhraseMatchId = crypto.randomUUID();
  const pagePhraseNonMatchId = crypto.randomUUID();
  const pageCatOnlyId = crypto.randomUUID();
  const pageCatAndDogId = crypto.randomUUID();
  const pageDogOnlyId = crypto.randomUUID();

  // For tie-breaking, ensure deterministic UUID ordering: tieId1 < tieId2
  const uuid1 = crypto.randomUUID();
  const uuid2 = crypto.randomUUID();
  const [pageTieId1, pageTieId2] = uuid1 < uuid2 ? [uuid1, uuid2] : [uuid2, uuid1];

  const pageVault2Id = crypto.randomUUID();
  const pageLockedId = crypto.randomUUID();

  const allPageIds = [
    pageHighDensityId,
    pageLowDensityId,
    pageTitleMatchId,
    pageTitleControlId,
    pageTagMatchId,
    pageTagControlId,
    pagePhraseMatchId,
    pagePhraseNonMatchId,
    pageCatOnlyId,
    pageCatAndDogId,
    pageDogOnlyId,
    pageTieId1,
    pageTieId2,
    pageVault2Id,
    pageLockedId,
  ];

  const allVaultIds = [vaultOpen1Id, vaultOpen2Id, vaultLockedId];

  try {
    // -----------------------------------------------------------------
    // 1. Seed Vaults
    // -----------------------------------------------------------------
    await db.insert(schema.vaults).values([
      {
        id: vaultOpen1Id,
        name: 'Lexical Test Open Vault 1',
        mode: 'open',
        owner_id: ownerId,
        data_key_id: 'mock-dek-lexical-1',
        export_policy: 'allowed_for_owner',
        created_at: new Date(),
      },
      {
        id: vaultOpen2Id,
        name: 'Lexical Test Open Vault 2',
        mode: 'open',
        owner_id: ownerId,
        data_key_id: 'mock-dek-lexical-2',
        export_policy: 'allowed_for_owner',
        created_at: new Date(),
      },
      {
        id: vaultLockedId,
        name: 'Lexical Test Locked Vault',
        mode: 'locked',
        owner_id: ownerId,
        data_key_id: 'mock-dek-lexical-3',
        export_policy: 'strictly_forbidden',
        created_at: new Date(),
      },
    ]);

    // -----------------------------------------------------------------
    // 2. Seed Pages
    // -----------------------------------------------------------------
    await db.insert(schema.pages).values([
      {
        id: pageHighDensityId,
        vault_id: vaultOpen1Id,
        type: 'decision',
        title: 'Storage Engine Benchmark',
        tags: ['architecture', 'benchmarks'],
        aliases: [],
        front_matter: {},
        created_at: new Date(),
      },
      {
        id: pageLowDensityId,
        vault_id: vaultOpen1Id,
        type: 'meeting',
        title: 'Project Retrospective',
        tags: ['planning'],
        aliases: [],
        front_matter: {},
        created_at: new Date(),
      },
      {
        id: pageTitleMatchId,
        vault_id: vaultOpen1Id,
        type: 'client',
        title: 'PostgreSQL Database Operations Guide',
        tags: ['client-guide'],
        aliases: [],
        front_matter: {},
        created_at: new Date(),
      },
      {
        id: pageTitleControlId,
        vault_id: vaultOpen1Id,
        type: 'client',
        title: 'PostgreSQL Database Administration Guide',
        tags: ['client-guide'],
        aliases: [],
        front_matter: {},
        created_at: new Date(),
      },
      {
        id: pageTagMatchId,
        vault_id: vaultOpen1Id,
        type: 'project',
        title: 'Enterprise Platform Architecture',
        tags: ['database', 'infrastructure'],
        aliases: [],
        front_matter: {},
        created_at: new Date(),
      },
      {
        id: pageTagControlId,
        vault_id: vaultOpen1Id,
        type: 'project',
        title: 'Enterprise Systems Architecture',
        tags: ['database', 'platform'],
        aliases: [],
        front_matter: {},
        created_at: new Date(),
      },
      {
        id: pagePhraseMatchId,
        vault_id: vaultOpen1Id,
        type: 'note',
        title: 'Consensus Protocols Note',
        tags: ['distributed'],
        aliases: [],
        front_matter: {},
        created_at: new Date(),
      },
      {
        id: pagePhraseNonMatchId,
        vault_id: vaultOpen1Id,
        type: 'note',
        title: 'Team Meeting Summary',
        tags: ['governance'],
        aliases: [],
        front_matter: {},
        created_at: new Date(),
      },
      {
        id: pageCatOnlyId,
        vault_id: vaultOpen1Id,
        type: 'note',
        title: 'Feline Observation Log',
        tags: ['pets'],
        aliases: [],
        front_matter: {},
        created_at: new Date(),
      },
      {
        id: pageCatAndDogId,
        vault_id: vaultOpen1Id,
        type: 'note',
        title: 'Animal Shelter Inventory',
        tags: ['pets'],
        aliases: [],
        front_matter: {},
        created_at: new Date(),
      },
      {
        id: pageDogOnlyId,
        vault_id: vaultOpen1Id,
        type: 'note',
        title: 'Canine Exercise Routine',
        tags: ['pets'],
        aliases: [],
        front_matter: {},
        created_at: new Date(),
      },
      {
        id: pageTieId1,
        vault_id: vaultOpen1Id,
        type: 'note',
        title: 'Deterministic Tie Alpha',
        tags: ['benchmark'],
        aliases: [],
        front_matter: {},
        created_at: new Date(),
      },
      {
        id: pageTieId2,
        vault_id: vaultOpen1Id,
        type: 'note',
        title: 'Deterministic Tie Beta',
        tags: ['benchmark'],
        aliases: [],
        front_matter: {},
        created_at: new Date(),
      },
      {
        id: pageVault2Id,
        vault_id: vaultOpen2Id,
        type: 'note',
        title: 'Database Secret Vault 2',
        tags: ['database'],
        aliases: [],
        front_matter: {},
        created_at: new Date(),
      },
      {
        id: pageLockedId,
        vault_id: vaultLockedId,
        type: 'skill',
        title: 'Confidential Database Skill',
        tags: ['database'],
        aliases: [],
        front_matter: {},
        created_at: new Date(),
      },
    ]);

    // -----------------------------------------------------------------
    // 3. Seed Versions (required by foreign key for chunks)
    // -----------------------------------------------------------------
    const versionInserts = allPageIds.map((pId) => ({
      id: crypto.randomUUID(),
      page_id: pId,
      number: 1,
      status: 'published',
      encrypted_blob: Buffer.from('mock-encrypted-version'),
      created_by: ownerId,
      created_at: new Date(),
    }));
    await db.insert(schema.versions).values(versionInserts);

    const versionMap = new Map(versionInserts.map((v) => [v.page_id, v.id]));

    // -----------------------------------------------------------------
    // 4. Seed Chunks with tsvector full-text representations
    // -----------------------------------------------------------------
    const chunkInserts = [
      // High density: multiple mentions of 'database'
      {
        id: crypto.randomUUID(),
        page_id: pageHighDensityId,
        version_id: versionMap.get(pageHighDensityId),
        position: 0,
        encrypted_text: Buffer.from('mock-encrypted-chunk'),
        tsv_content: sql`to_tsvector('english', 'database architecture database storage database indexing database performance database engine')`,
      },
      // Low density: single mention of 'database'
      {
        id: crypto.randomUUID(),
        page_id: pageLowDensityId,
        version_id: versionMap.get(pageLowDensityId),
        position: 0,
        encrypted_text: Buffer.from('mock-encrypted-chunk'),
        tsv_content: sql`to_tsvector('english', 'this general document briefly mentions a database once in passing')`,
      },
      // Title match: single mention in content, title contains 'Operations'
      {
        id: crypto.randomUUID(),
        page_id: pageTitleMatchId,
        version_id: versionMap.get(pageTitleMatchId),
        position: 0,
        encrypted_text: Buffer.from('mock-encrypted-chunk'),
        tsv_content: sql`to_tsvector('english', 'standard system administration operations overview')`,
      },
      // Title control: identical chunk content, but title does NOT contain 'Operations'
      {
        id: crypto.randomUUID(),
        page_id: pageTitleControlId,
        version_id: versionMap.get(pageTitleControlId),
        position: 0,
        encrypted_text: Buffer.from('mock-encrypted-chunk'),
        tsv_content: sql`to_tsvector('english', 'standard system administration operations overview')`,
      },
      // Tag match: single mention in content, tags contains 'infrastructure', title does NOT
      {
        id: crypto.randomUUID(),
        page_id: pageTagMatchId,
        version_id: versionMap.get(pageTagMatchId),
        position: 0,
        encrypted_text: Buffer.from('mock-encrypted-chunk'),
        tsv_content: sql`to_tsvector('english', 'cloud hosting infrastructure platform and services')`,
      },
      // Tag control: identical chunk content, but tags does NOT contain 'infrastructure'
      {
        id: crypto.randomUUID(),
        page_id: pageTagControlId,
        version_id: versionMap.get(pageTagControlId),
        position: 0,
        encrypted_text: Buffer.from('mock-encrypted-chunk'),
        tsv_content: sql`to_tsvector('english', 'cloud hosting infrastructure platform and services')`,
      },
      // Phrase match: exact phrase 'distributed consensus'
      {
        id: crypto.randomUUID(),
        page_id: pagePhraseMatchId,
        version_id: versionMap.get(pagePhraseMatchId),
        position: 0,
        encrypted_text: Buffer.from('mock-encrypted-chunk'),
        tsv_content: sql`to_tsvector('english', 'we implement distributed consensus protocols using raft and paxos')`,
      },
      // Phrase non-match: separated words 'consensus on distributed systems'
      {
        id: crypto.randomUUID(),
        page_id: pagePhraseNonMatchId,
        version_id: versionMap.get(pagePhraseNonMatchId),
        position: 0,
        encrypted_text: Buffer.from('mock-encrypted-chunk'),
        tsv_content: sql`to_tsvector('english', 'we reached consensus on distributed systems across engineering teams')`,
      },
      // Cat only
      {
        id: crypto.randomUUID(),
        page_id: pageCatOnlyId,
        version_id: versionMap.get(pageCatOnlyId),
        position: 0,
        encrypted_text: Buffer.from('mock-encrypted-chunk'),
        tsv_content: sql`to_tsvector('english', 'the orange cat sleeps in the warm sunlight')`,
      },
      // Cat and dog
      {
        id: crypto.randomUUID(),
        page_id: pageCatAndDogId,
        version_id: versionMap.get(pageCatAndDogId),
        position: 0,
        encrypted_text: Buffer.from('mock-encrypted-chunk'),
        tsv_content: sql`to_tsvector('english', 'the animal shelter cares for every cat and dog equally')`,
      },
      // Dog only
      {
        id: crypto.randomUUID(),
        page_id: pageDogOnlyId,
        version_id: versionMap.get(pageDogOnlyId),
        position: 0,
        encrypted_text: Buffer.from('mock-encrypted-chunk'),
        tsv_content: sql`to_tsvector('english', 'the energetic dog runs fast across the park')`,
      },
      // Tie page 1
      {
        id: crypto.randomUUID(),
        page_id: pageTieId1,
        version_id: versionMap.get(pageTieId1),
        position: 0,
        encrypted_text: Buffer.from('mock-encrypted-chunk'),
        tsv_content: sql`to_tsvector('english', 'identical tied benchmark content for testing deterministic ordering')`,
      },
      // Tie page 2
      {
        id: crypto.randomUUID(),
        page_id: pageTieId2,
        version_id: versionMap.get(pageTieId2),
        position: 0,
        encrypted_text: Buffer.from('mock-encrypted-chunk'),
        tsv_content: sql`to_tsvector('english', 'identical tied benchmark content for testing deterministic ordering')`,
      },
      // Vault 2 page (high density of 'database')
      {
        id: crypto.randomUUID(),
        page_id: pageVault2Id,
        version_id: versionMap.get(pageVault2Id),
        position: 0,
        encrypted_text: Buffer.from('mock-encrypted-chunk'),
        tsv_content: sql`to_tsvector('english', 'database database database database database database')`,
      },
    ];

    await db.insert(schema.chunks).values(chunkInserts);

    // -----------------------------------------------------------------
    // Criterion 1: Stronger lexical match > weaker match (ts_rank_cd cover density)
    // -----------------------------------------------------------------
    await t.test('Criterion 1: Higher term density yields strictly higher ts_rank_cd lexical score', async () => {
      const results = await searchPages(vaultOpen1Id, 'database');
      const highDoc = results.find((r) => r.id === pageHighDensityId);
      const lowDoc = results.find((r) => r.id === pageLowDensityId);

      assert.ok(highDoc, 'High density page must be returned');
      assert.ok(lowDoc, 'Low density page must be returned');
      assert.ok(
        highDoc.score > lowDoc.score,
        `Expected high density score (${highDoc.score}) > low density score (${lowDoc.score})`
      );
    });

    // -----------------------------------------------------------------
    // Criterion 2: Title boosting (+0.50)
    // -----------------------------------------------------------------
    await t.test('Criterion 2: Title match applies +0.50 boost outranking content-only match', async () => {
      const results = await searchPages(vaultOpen1Id, 'operations');
      const titleDoc = results.find((r) => r.id === pageTitleMatchId);
      const controlDoc = results.find((r) => r.id === pageTitleControlId);

      assert.ok(titleDoc, 'Title matched document must be returned');
      assert.ok(controlDoc, 'Content-only control document must be returned');

      const titleIndex = results.findIndex((r) => r.id === pageTitleMatchId);
      const controlIndex = results.findIndex((r) => r.id === pageTitleControlId);
      assert.ok(titleIndex < controlIndex, 'Title-matched page must appear before content-only control');

      // Title-matched page receives documented +0.50 boost over identical content-only match
      const delta = titleDoc.score - controlDoc.score;
      assert.ok(
        Math.abs(delta - 0.50) < 0.05,
        `Expected title score (${titleDoc.score}) to exceed control score (${controlDoc.score}) by ~0.50, delta: ${delta}`
      );
    });

    // -----------------------------------------------------------------
    // Criterion 3: Tag boosting (+0.20)
    // -----------------------------------------------------------------
    await t.test('Criterion 3: Tag match applies +0.20 boost outranking non-tagged document', async () => {
      const results = await searchPages(vaultOpen1Id, 'infrastructure');
      const tagDoc = results.find((r) => r.id === pageTagMatchId);
      const controlDoc = results.find((r) => r.id === pageTagControlId);

      assert.ok(tagDoc, 'Tag matched document must be returned');
      assert.ok(controlDoc, 'Non-tagged control document must be returned');

      const tagIndex = results.findIndex((r) => r.id === pageTagMatchId);
      const controlIndex = results.findIndex((r) => r.id === pageTagControlId);
      assert.ok(tagIndex < controlIndex, 'Tag-matched page must appear before non-tagged control');

      // Tag-matched page receives documented +0.20 boost over identical non-tagged match
      const delta = tagDoc.score - controlDoc.score;
      assert.ok(
        Math.abs(delta - 0.20) < 0.05,
        `Expected tag score (${tagDoc.score}) to exceed control score (${controlDoc.score}) by ~0.20, delta: ${delta}`
      );
    });

    // -----------------------------------------------------------------
    // Criterion 4: Quoted phrase ("exact phrase") via websearch_to_tsquery
    // -----------------------------------------------------------------
    await t.test('Criterion 4: Quoted phrase enforces strict token adjacency', async () => {
      const results = await searchPages(vaultOpen1Id, '"distributed consensus"');
      const matchDoc = results.find((r) => r.id === pagePhraseMatchId);
      const nonMatchDoc = results.find((r) => r.id === pagePhraseNonMatchId);

      assert.ok(matchDoc, 'Adjacent phrase "distributed consensus" must match');
      assert.equal(nonMatchDoc, undefined, 'Separated words must NOT match quoted phrase');
    });

    // -----------------------------------------------------------------
    // Criterion 5: Ordinary punctuation safely parsed without SQL errors
    // -----------------------------------------------------------------
    await t.test('Criterion 5: User punctuation handled safely without SQL syntax errors', async () => {
      // 5.1 Query with punctuation around matching terms
      const punctuationQuery = 'consensus??? (protocols) [raft]!';
      const results = await searchPages(vaultOpen1Id, punctuationQuery);
      assert.ok(Array.isArray(results), 'Must return array without throwing SQL error');
      const matchDoc = results.find((r) => r.id === pagePhraseMatchId);
      assert.ok(matchDoc, 'Must match lexemes despite surrounding punctuation');

      // 5.2 Pure punctuation that produces empty tsquery
      const purePunctuation = '!@#$%^&*()_+';
      const punctResults = await searchPages(vaultOpen1Id, purePunctuation);
      assert.ok(Array.isArray(punctResults), 'Pure punctuation must not throw SQL error');
    });

    // -----------------------------------------------------------------
    // Criterion 6: OR and -term exclusions
    // -----------------------------------------------------------------
    await t.test('Criterion 6: Safe support for OR operators and -term exclusions', async () => {
      // 6.1 OR query: matches either
      const orResults = await searchPages(vaultOpen1Id, 'cat OR dog');
      const catDoc = orResults.find((r) => r.id === pageCatOnlyId);
      const dogDoc = orResults.find((r) => r.id === pageDogOnlyId);
      const bothDoc = orResults.find((r) => r.id === pageCatAndDogId);

      assert.ok(catDoc, 'cat OR dog must match cat-only page');
      assert.ok(dogDoc, 'cat OR dog must match dog-only page');
      assert.ok(bothDoc, 'cat OR dog must match both page');

      // 6.2 Exclusion query: cat -dog
      const notResults = await searchPages(vaultOpen1Id, 'cat -dog');
      const excludedBoth = notResults.find((r) => r.id === pageCatAndDogId);
      const excludedDog = notResults.find((r) => r.id === pageDogOnlyId);
      const keptCat = notResults.find((r) => r.id === pageCatOnlyId);

      assert.ok(keptCat, 'cat -dog must keep cat-only page');
      assert.equal(excludedBoth, undefined, 'cat -dog must strictly exclude pages containing dog');
      assert.equal(excludedDog, undefined, 'cat -dog must exclude dog-only page');
    });

    // -----------------------------------------------------------------
    // Criterion 7: Deterministic tie-breaking order (score DESC, page_id ASC)
    // -----------------------------------------------------------------
    await t.test('Criterion 7: Deterministic tie-breaking orders tied scores by page_id ASC', async () => {
      // Note on observable tie-breaking:
      // Page-ID tie-breaking is behaviorally tested here via page_id ASC.
      // Chunk-position and chunk-ID ordering are encoded in production SQL:
      //   ORDER BY rank_score DESC, p.id ASC, COALESCE(c.position, 0) ASC, COALESCE(c.id, '00000000-0000-0000-0000-000000000000'::uuid) ASC
      // Because searchPages deduplicates results per pageId, chunk-level position and chunk ID
      // ordering are internal to query execution and not externally observable in the page-level response.
      const results = await searchPages(vaultOpen1Id, 'tied benchmark content');
      const tie1Index = results.findIndex((r) => r.id === pageTieId1);
      const tie2Index = results.findIndex((r) => r.id === pageTieId2);

      assert.ok(tie1Index !== -1, 'pageTieId1 must be in results');
      assert.ok(tie2Index !== -1, 'pageTieId2 must be in results');
      // pageTieId1 was specifically selected such that pageTieId1 < pageTieId2
      assert.ok(pageTieId1 < pageTieId2, 'pageTieId1 must be lexicographically smaller than pageTieId2');
      assert.ok(tie1Index < tie2Index, 'Smaller UUID pageTieId1 must precede pageTieId2 on tied score');
    });

    // -----------------------------------------------------------------
    // Criterion 8: Real page types and tags preserved from database
    // -----------------------------------------------------------------
    await t.test('Criterion 8: Real database page type and tags are preserved without hardcoding', async () => {
      const results = await searchPages(vaultOpen1Id, 'database');
      const decisionDoc = results.find((r) => r.id === pageHighDensityId);
      const meetingDoc = results.find((r) => r.id === pageLowDensityId);
      const clientDoc = results.find((r) => r.id === pageTitleMatchId);
      const projectDoc = results.find((r) => r.id === pageTagMatchId);

      assert.ok(decisionDoc);
      assert.equal(decisionDoc.type, 'decision', 'Must preserve real database type "decision"');
      assert.deepEqual(decisionDoc.tags, ['architecture', 'benchmarks'], 'Must preserve real tags');

      assert.ok(meetingDoc);
      assert.equal(meetingDoc.type, 'meeting', 'Must preserve real database type "meeting"');

      assert.ok(clientDoc);
      assert.equal(clientDoc.type, 'client', 'Must preserve real database type "client"');

      assert.ok(projectDoc);
      assert.equal(projectDoc.type, 'project', 'Must preserve real database type "project"');
    });

    // -----------------------------------------------------------------
    // Criterion 9: Cross-vault isolation (Vault 2 excluded)
    // -----------------------------------------------------------------
    await t.test('Criterion 9: Cross-vault isolation strictly excludes pages from other vaults', async () => {
      const results = await searchPages(vaultOpen1Id, 'database');
      const vault2Doc = results.find((r) => r.id === pageVault2Id);
      assert.equal(vault2Doc, undefined, 'Vault 2 document must NEVER appear in Vault 1 search results');
    });

    // -----------------------------------------------------------------
    // Criterion 10: Locked-vault returns [] (Zero-Read Invariant / ADR-017)
    // -----------------------------------------------------------------
    await t.test('Criterion 10: Locked vaults return [] with zero document disclosure', async () => {
      const results = await searchPages(vaultLockedId, 'database');
      assert.deepEqual(results, [], 'Locked vault search must always return empty array []');
    });

    // -----------------------------------------------------------------
    // Criterion 11: Unknown or invalid vault ID returns [] safely
    // -----------------------------------------------------------------
    await t.test('Criterion 11: Unknown UUID or malformed vault ID returns [] without error', async () => {
      const nonExistentUuid = crypto.randomUUID();
      const unknownResults = await searchPages(nonExistentUuid, 'database');
      assert.deepEqual(unknownResults, []);

      const invalidResults = await searchPages('not-a-valid-uuid', 'database');
      assert.deepEqual(invalidResults, []);
    });

    // -----------------------------------------------------------------
    // Criterion 12: Empty or whitespace query returns []
    // -----------------------------------------------------------------
    await t.test('Criterion 12: Empty or whitespace query returns [] immediately', async () => {
      assert.deepEqual(await searchPages(vaultOpen1Id, ''), []);
      assert.deepEqual(await searchPages(vaultOpen1Id, '   '), []);
      assert.deepEqual(await searchPages(vaultOpen1Id, '\t\n'), []);
    });

    // -----------------------------------------------------------------
    // Criterion 13: Snippet safety: snippet is '' and never exposes tsvector lexemes
    // -----------------------------------------------------------------
    await t.test('Criterion 13: Safe metadata-only snippets: snippet is empty string and never leaks tsvector lexemes', async () => {
      const results = await searchPages(vaultOpen1Id, 'database');
      assert.ok(results.length > 0);
      for (const r of results) {
        assert.equal(r.snippet, '', 'Snippet must be empty string in metadata-only search');
        // Ensure no tsvector internal syntax (e.g. 'databas':1) leaks in any field
        assert.ok(!r.snippet.includes("':"), 'tsvector syntax leaked into snippet');
        assert.ok(!JSON.stringify(r).includes("':"), 'tsvector syntax leaked into result object');
      }
    });

  } finally {
    // Restore original OPENAI_API_KEY environment variable if originally set
    if (originalOpenAiKey !== undefined) {
      process.env.OPENAI_API_KEY = originalOpenAiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }

    // Teardown: delete test rows in reverse dependency order
    let cleanupError = null;
    try {
      await db.delete(schema.chunks).where(inArray(schema.chunks.page_id, allPageIds));
      await db.delete(schema.versions).where(inArray(schema.versions.page_id, allPageIds));
      await db.delete(schema.pages).where(inArray(schema.pages.id, allPageIds));
      await db.delete(schema.vaults).where(inArray(schema.vaults.id, allVaultIds));
    } catch (cleanupErr) {
      cleanupError = cleanupErr;
    }

    if (cleanupError) {
      throw new Error(`Database cleanup failed: ${cleanupError.message}`);
    }
  }
});
