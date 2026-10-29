import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { register } from 'node:module';

register(new URL('./helpers/tsx-loader.js', import.meta.url).href, import.meta.url);

// TipTap needs a DOM. Install one before the editor modules are imported.
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
for (const key of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'DOMParser', 'MutationObserver', 'getComputedStyle']) {
  if (!(key in globalThis)) globalThis[key] = dom.window[key];
}
if (!('navigator' in globalThis) || !globalThis.navigator?.userAgent) {
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
}

const { Editor } = await import('@tiptap/react');
const { default: StarterKit } = await import('@tiptap/starter-kit');
const { Markdown } = await import('tiptap-markdown');
const { MarkdownEngine } = await import('@tkxel-vault/vault-core/markdown');
const { normalizeEditorMarkdown } = await import('../src/utils/editor-markdown.ts');

// Same Markdown serializer configuration as components/editor/MarkdownEditor.tsx
function roundTrip(markdown) {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
    ],
    content: markdown,
  });
  try {
    return editor.storage.markdown.getMarkdown();
  } finally {
    editor.destroy();
  }
}

test('Editor round-trip: wiki-links, aliases, typed links and tags survive TipTap serialization', () => {
  const source = [
    '# Acme Corp',
    '',
    'See [[Payment Architecture Reference]] and [[Sara Khan|Sara]].',
    '',
    '- Blocked by [[blocked_by::Vendor Contract]]',
    '- Tagged #fintech and #enterprise_2026',
  ].join('\n');

  const saved = normalizeEditorMarkdown(roundTrip(source));

  assert.ok(saved.includes('[[Payment Architecture Reference]]'), `wiki-link was mangled: ${saved}`);
  assert.ok(saved.includes('[[Sara Khan|Sara]]'), `aliased wiki-link was mangled: ${saved}`);
  assert.ok(saved.includes('[[blocked_by::Vendor Contract]]'), `typed wiki-link was mangled: ${saved}`);
  assert.ok(!saved.includes('\\['), 'no escaped brackets may remain around wiki-links');
  assert.ok(saved.includes('#enterprise_2026'), `tag was mangled: ${saved}`);

  const parsed = MarkdownEngine.parse(saved);
  assert.equal(parsed.links.length, 3, 'the server-side parser must still find every link after a save');

  // Saving twice must be stable
  assert.equal(normalizeEditorMarkdown(roundTrip(saved)), saved);
});

test('Editor round-trip: intentionally escaped brackets outside wiki-links are left alone', () => {
  const saved = normalizeEditorMarkdown('Array index a\\[0\\] and a link [[Real Page]]');
  assert.ok(saved.includes('a\\[0\\]'));
  assert.ok(saved.includes('[[Real Page]]'));
});

test('Editor round-trip: bracket text inside code is never rewritten', () => {
  const source = 'Inline `\[\[not a link\]\]` stays.\n\n```\n\[\[also not a link\]\]\n```\n\nBut \[\[Real Link\]\] is restored.';
  const saved = normalizeEditorMarkdown(source);
  assert.ok(saved.includes('`\[\[not a link\]\]`'));
  assert.ok(saved.includes('\n\[\[also not a link\]\]\n'));
  assert.ok(saved.includes('But [[Real Link]] is restored.'));
});

test('Editor round-trip: vault-hosted image references survive serialization unchanged (FR-02)', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.sessionStorage ??= { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const { VaultImage, assetIdFromSrc, VAULT_ASSET_SCHEME } = await import('../src/components/editor/VaultImage.ts');

  const assetId = '3f2b8c1e-5a47-4d09-9b6e-2c1f0a7d4e55';
  const source = `# Architecture

See the diagram:

![System diagram](${VAULT_ASSET_SCHEME}${assetId})

And [[Payment Architecture]].`;

  const editor = new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      VaultImage.configure({ inline: false, allowBase64: false }),
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
    ],
    content: source,
  });
  let saved;
  try {
    saved = normalizeEditorMarkdown(editor.storage.markdown.getMarkdown());
    const imageNodes = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'image') imageNodes.push(node.attrs);
    });
    assert.equal(imageNodes.length, 1, 'the reference is parsed into an image node');
    assert.equal(imageNodes[0].src, `${VAULT_ASSET_SCHEME}${assetId}`);
  } finally {
    editor.destroy();
  }

  assert.ok(saved.includes(`![System diagram](${VAULT_ASSET_SCHEME}${assetId})`), `image reference was mangled: ${saved}`);
  assert.ok(saved.includes('[[Payment Architecture]]'));

  assert.equal(assetIdFromSrc(`${VAULT_ASSET_SCHEME}${assetId}`), assetId);
  assert.equal(assetIdFromSrc('https://tracker.example.net/pixel.png'), null, 'external images are never treated as vault assets');
  assert.equal(assetIdFromSrc(`${VAULT_ASSET_SCHEME}../../etc/passwd`), null);
});
