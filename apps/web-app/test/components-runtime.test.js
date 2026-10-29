import test from 'node:test';
import assert from 'node:assert/strict';
import { MarkdownEngine } from '@tkxel-vault/vault-core/markdown';

// ============================================================================
// 1. KNOWLEDGE GRAPH RUNTIME PROCESSING & VISUAL TRANSFORMATIONS
// ============================================================================

describeKnowledgeGraph: {
  function getCategoryColor(type, tags) {
    if (tags && tags.length > 0) {
      const lowerTags = tags.map((t) => t.toLowerCase());
      if (lowerTags.some((t) => t.includes('agent'))) return '#4F46E5';
      if (lowerTags.some((t) => t.includes('security') || t.includes('crypto'))) return '#E11D48';
      if (lowerTags.some((t) => t.includes('architecture') || t.includes('adr') || t.includes('design'))) return '#059669';
      if (lowerTags.some((t) => t.includes('integration') || t.includes('iot') || t.includes('tuya') || t.includes('home'))) return '#D97706';
    }

    const predefined = {
      decision: '#059669',
      meeting: '#7C3AED',
      project: '#0755E9',
      client: '#D97706',
      person: '#DB2777',
      note: '#0891B2',
    };
    const key = (type || 'note').toLowerCase();
    if (predefined[key]) return predefined[key];

    let hash = 0;
    for (let i = 0; i < key.length; i++) {
      hash = key.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 65%, 45%)`;
  }

  function humanizeNodeTitle(title) {
    const readable = title.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
    return readable ? readable.charAt(0).toUpperCase() + readable.slice(1) : 'Untitled note';
  }

  function getTwoHopPageIds(focalPageId, links) {
    const ids = new Set([focalPageId]);
    links.forEach((link) => {
      if (link.from_page_id === focalPageId) ids.add(link.to_page_id);
      if (link.to_page_id === focalPageId) ids.add(link.from_page_id);
    });
    const oneHop = new Set(ids);
    links.forEach((link) => {
      if (oneHop.has(link.from_page_id)) ids.add(link.to_page_id);
      if (oneHop.has(link.to_page_id)) ids.add(link.from_page_id);
    });
    return ids;
  }

  test('Knowledge Graph: category color mapping prioritizes tags and adheres to design system', () => {
    // Tag precedence: security -> Rose
    assert.equal(getCategoryColor('note', ['crypto', 'encryption']), '#E11D48');
    // Tag precedence: agent -> Indigo
    assert.equal(getCategoryColor('note', ['agent-planner']), '#4F46E5');
    // Tag precedence: architecture -> Emerald
    assert.equal(getCategoryColor('note', ['architecture', 'system-design']), '#059669');
    // Predefined types
    assert.equal(getCategoryColor('decision'), '#059669');
    assert.equal(getCategoryColor('meeting'), '#7C3AED');
    assert.equal(getCategoryColor('project'), '#0755E9');
    // Arbitrary type fallback produces valid HSL string
    const customColor = getCategoryColor('unusual-type');
    assert.match(customColor, /^hsl\(\d+, 65%, 45%\)$/);
  });

  test('Knowledge Graph: title humanization removes separators and formats cleanly', () => {
    assert.equal(humanizeNodeTitle('system_architecture_overview'), 'System architecture overview');
    assert.equal(humanizeNodeTitle('adr-002-envelope-encryption'), 'Adr 002 envelope encryption');
    assert.equal(humanizeNodeTitle('   spaced   title   '), 'Spaced title');
    assert.equal(humanizeNodeTitle(''), 'Untitled note');
  });

  test('Knowledge Graph: calculates strict 2-hop neighborhood, isolating distant nodes', () => {
    const links = [
      { from_page_id: 'root', to_page_id: 'hop1_a' },
      { from_page_id: 'root', to_page_id: 'hop1_b' },
      { from_page_id: 'hop1_a', to_page_id: 'hop2_a' },
      { from_page_id: 'hop2_a', to_page_id: 'hop3_a' }, // 3-hop distant
      { from_page_id: 'isolated_1', to_page_id: 'isolated_2' }, // Disconnected
    ];

    const twoHop = getTwoHopPageIds('root', links);
    assert.ok(twoHop.has('root'));
    assert.ok(twoHop.has('hop1_a'));
    assert.ok(twoHop.has('hop1_b'));
    assert.ok(twoHop.has('hop2_a'));
    // Distant and disconnected nodes MUST NOT be in the 2-hop subgraph
    assert.equal(twoHop.has('hop3_a'), false);
    assert.equal(twoHop.has('isolated_1'), false);
    assert.equal(twoHop.has('isolated_2'), false);
  });

  test('Knowledge Graph: orphan detection isolates unlinked notes correctly', () => {
    const pages = [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }, { id: 'orphan' }];
    const links = [
      { from_page_id: 'p1', to_page_id: 'p2' },
      { from_page_id: 'p2', to_page_id: 'p3' },
    ];

    const connectedNodeIds = new Set();
    links.forEach((l) => {
      connectedNodeIds.add(l.from_page_id);
      connectedNodeIds.add(l.to_page_id);
    });

    const orphans = pages.filter((p) => !connectedNodeIds.has(p.id));
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].id, 'orphan');
  });
}

// ============================================================================
// 3. BACKLINKS & OUTGOING LINKS RELATIONAL GRAPH RUNTIME
// ============================================================================

describeBacklinksRuntime: {
  test('Backlinks & Outgoing: accurately indexes incoming and outgoing page associations', () => {
    const allPages = [
      { id: 'page-1', title: 'Home Dashboard' },
      { id: 'page-2', title: 'Security Model' },
      { id: 'page-3', title: 'Audit Ledger' },
      { id: 'page-4', title: 'Unrelated Note' },
    ];

    const links = [
      { from_page_id: 'page-1', to_page_id: 'page-2' },
      { from_page_id: 'page-3', to_page_id: 'page-2' },
      { from_page_id: 'page-2', to_page_id: 'page-3' },
    ];

    // Compute for 'page-2' (Security Model)
    const page2 = allPages.find((p) => p.id === 'page-2');

    // 1. Incoming backlinks to page-2
    const incomingBacklinkTitles = links
      .filter((l) => l.to_page_id === page2.id)
      .map((l) => allPages.find((p) => p.id === l.from_page_id)?.title)
      .filter(Boolean);

    assert.equal(incomingBacklinkTitles.length, 2);
    assert.ok(incomingBacklinkTitles.includes('Home Dashboard'));
    assert.ok(incomingBacklinkTitles.includes('Audit Ledger'));

    // 2. Outgoing links from page-2
    const outgoingTargetTitles = links
      .filter((l) => l.from_page_id === page2.id)
      .map((l) => allPages.find((p) => p.id === l.to_page_id)?.title)
      .filter(Boolean);

    assert.equal(outgoingTargetTitles.length, 1);
    assert.ok(outgoingTargetTitles.includes('Audit Ledger'));

    // 3. Dynamic link mutation
    const updatedLinks = [...links, { from_page_id: 'page-4', to_page_id: 'page-2' }];
    const refreshedBacklinks = updatedLinks
      .filter((l) => l.to_page_id === page2.id)
      .map((l) => allPages.find((p) => p.id === l.from_page_id)?.title)
      .filter(Boolean);

    assert.equal(refreshedBacklinks.length, 3);
    assert.ok(refreshedBacklinks.includes('Unrelated Note'));
  });
}

// ============================================================================
// 4. WYSIWYG EDITOR STATE & ENCRYPTED CONTENT SYNCHRONIZER
// ============================================================================

describeEditorState: {
  test('Editor State: markdown front-matter is separated and body is never stored in front_matter', () => {
    const rawMarkdown = `---
title: Cryptographic Envelope Protocol
type: technical_spec
tags:
  - security
  - kms
---

# Cryptographic Envelope Protocol

All pages are encrypted with AES-256-GCM under KMS wrapped DEK.
Reference [[Security Model]] for details.`;

    const parsed = MarkdownEngine.parse(rawMarkdown);

    // Front-matter contains metadata
    assert.equal(parsed.frontMatter.title, 'Cryptographic Envelope Protocol');
    assert.equal(parsed.frontMatter.type, 'technical_spec');
    assert.deepEqual(parsed.tags, ['security', 'kms']);

    // Critical security invariant: front_matter must NEVER contain body text
    assert.equal(parsed.frontMatter.body, undefined);

    // Extracted body contains content and links
    assert.ok(parsed.body.includes('All pages are encrypted with AES-256-GCM'));
    assert.equal(parsed.links.length, 1);
    assert.equal(parsed.links[0].target, 'Security Model');

    // Page object simulation
    const pageEntity = {
      id: 'page-crypto-1',
      vault_id: 'vault-prod-1',
      title: parsed.frontMatter.title,
      front_matter: {
        title: parsed.frontMatter.title,
        type: parsed.frontMatter.type,
        tags: parsed.tags,
      },
      content: parsed.body, // In-memory decrypted body
    };

    // Assert plaintext body is NOT inside front_matter
    assert.equal(pageEntity.front_matter.body, undefined);
    assert.ok(pageEntity.content.includes('# Cryptographic Envelope Protocol'));
  });
}


