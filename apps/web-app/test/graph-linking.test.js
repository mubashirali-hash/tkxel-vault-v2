import test from 'node:test';
import assert from 'node:assert/strict';

function linkNotes(sourcePage, targetPage, currentLinks) {
  if (!sourcePage || !targetPage) {
    throw new Error('Both source and target pages are required');
  }
  if (sourcePage.id === targetPage.id) {
    throw new Error('Cannot link a note to itself');
  }

  // Check if link already exists in either direction or from source to target
  const exists = currentLinks.some(
    (l) => l.from_page_id === sourcePage.id && l.to_page_id === targetPage.id
  );
  if (exists) {
    return {
      updatedSourcePage: sourcePage,
      updatedLinks: currentLinks,
      alreadyExisted: true,
    };
  }

  // Append wiki-link to source note markdown body
  const currentBody = sourcePage.front_matter?.body || '';
  const linkSyntax = `[[${targetPage.title}]]`;
  const newBody = currentBody.trim()
    ? `${currentBody}\n\n- ${linkSyntax}`
    : `- ${linkSyntax}`;

  const updatedSourcePage = {
    ...sourcePage,
    front_matter: {
      ...sourcePage.front_matter,
      body: newBody,
    },
    updated_at: new Date(),
  };

  const updatedLinks = [
    ...currentLinks,
    { from_page_id: sourcePage.id, to_page_id: targetPage.id },
  ];

  return {
    updatedSourcePage,
    updatedLinks,
    alreadyExisted: false,
  };
}

test('Graph Linking: successfully connects two notes and appends [[target]] to source markdown', () => {
  const pageA = {
    id: 'pg_1',
    title: 'Architecture Decision',
    front_matter: {
      title: 'Architecture Decision',
      body: '# Architecture\n\nInitial draft of system invariants.',
    },
  };

  const pageB = {
    id: 'pg_2',
    title: 'Security Model',
    front_matter: {
      title: 'Security Model',
      body: '# Security\n\nZero-read locked vaults.',
    },
  };

  const initialLinks = [];

  const result = linkNotes(pageA, pageB, initialLinks);

  assert.equal(result.alreadyExisted, false);
  assert.equal(result.updatedLinks.length, 1);
  assert.deepEqual(result.updatedLinks[0], {
    from_page_id: 'pg_1',
    to_page_id: 'pg_2',
  });
  assert.ok(result.updatedSourcePage.front_matter.body.includes('- [[Security Model]]'));
});

test('Graph Linking: rejects self-linking', () => {
  const pageA = { id: 'pg_1', title: 'Self Note' };

  assert.throws(() => {
    linkNotes(pageA, pageA, []);
  }, /Cannot link a note to itself/);
});

test('Graph Linking: avoids duplicate links if already connected', () => {
  const pageA = { id: 'pg_1', title: 'Note 1', front_matter: { body: 'content' } };
  const pageB = { id: 'pg_2', title: 'Note 2' };

  const existingLinks = [{ from_page_id: 'pg_1', to_page_id: 'pg_2' }];
  const result = linkNotes(pageA, pageB, existingLinks);

  assert.equal(result.alreadyExisted, true);
  assert.equal(result.updatedLinks.length, 1);
  assert.equal(result.updatedSourcePage, pageA);
});
