import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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
const { UnresolvedLinks, unresolvedLinksKey, findUnresolvedLinks, wikiLinkTargetTitle } = await import('../src/components/editor/UnresolvedLinks.ts');
const { splitLinkQuery, formatLinkTarget } = await import('../src/components/editor/WikiLinkPicker.tsx');
const { getEditorMarkdown } = await import('../src/utils/editor-markdown.ts');

function createEditor(markdown, known, onUpdate = () => {}) {
  return new Editor({
    element: document.createElement('div'),
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      UnresolvedLinks.configure({ isResolved: (title) => known.has(title.toLowerCase()) }),
      Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
    ],
    content: markdown,
    onUpdate,
  });
}

const decoratedText = (editor) =>
  unresolvedLinksKey.getState(editor.state).find().map((d) => editor.state.doc.textBetween(d.from, d.to));

test('FR-11: links to pages that do not exist are marked, existing ones are not', () => {
  const known = new Set(['acme corp', 'acme']);
  const editor = createEditor(
    'See [[Acme Corp]] and [[Missing Page]].\n\nAlias [[ACME|the client]], typed [[works_at::Acme Corp]] and [[owns::Nowhere]].\n\n`[[In Code]]`\n\n```\n[[In Block]]\n```',
    known
  );
  try {
    assert.deepEqual(decoratedText(editor), ['[[Missing Page]]', '[[owns::Nowhere]]']);
    assert.deepEqual(findUnresolvedLinks(editor.state.doc, () => false).map((r) => r.title), ['Acme Corp', 'Missing Page', 'ACME', 'Acme Corp', 'Nowhere']);
  } finally {
    editor.destroy();
  }
});

test('FR-11: marking links never changes the saved Markdown or reports an edit', () => {
  const known = new Set();
  let updates = 0;
  const source = 'A [[Ghost]] link and a [[rel::Typed Ghost]] link.';
  const editor = createEditor(source, known, () => { updates++; });
  try {
    assert.equal(decoratedText(editor).length, 2);

    // The page now exists: the editor is told to re-check, which must not count as an edit
    known.add('ghost');
    editor.view.dispatch(editor.state.tr.setMeta(unresolvedLinksKey, true));
    assert.deepEqual(decoratedText(editor), ['[[rel::Typed Ghost]]']);
    assert.equal(updates, 0);
    assert.equal(getEditorMarkdown(editor), source);
  } finally {
    editor.destroy();
  }
});

test('Opening a note does not report an edit: edit permission is synced without an update event', () => {
  let updates = 0;
  const editor = createEditor('Unchanged text.', new Set(), () => { updates++; });
  try {
    editor.setEditable(false, false);
    editor.setEditable(true, false);
    assert.equal(updates, 0);
    // The default form is what used to trigger an autosave of an unchanged draft on every open
    editor.setEditable(true);
    assert.equal(updates, 1);
  } finally {
    editor.destroy();
  }
  const source = fs.readFileSync(new URL('../src/components/editor/MarkdownEditor.tsx', import.meta.url), 'utf8');
  assert.match(source, /editor\.setEditable\(canEdit, false\)/);
  assert.doesNotMatch(source, /editor\.setEditable\(canEdit\)/);
});

test('FR-15: the link picker builds typed links that the Markdown parser reads back', () => {
  assert.deepEqual(splitLinkQuery('Acme'), { relation: '', search: 'Acme' });
  assert.deepEqual(splitLinkQuery('works_at::Ac'), { relation: 'works_at', search: 'Ac' });
  assert.equal(formatLinkTarget('Acme Corp'), 'Acme Corp');
  assert.equal(formatLinkTarget('Acme Corp', 'references'), 'Acme Corp');
  assert.equal(formatLinkTarget('Acme Corp', 'works_at'), 'works_at::Acme Corp');
  assert.equal(wikiLinkTargetTitle('works_at::Acme Corp|employer'), 'Acme Corp');

  const parsed = MarkdownEngine.parse(`Jo [[${formatLinkTarget('Acme Corp', 'works_at')}]] and [[${formatLinkTarget('Plain')}]].`);
  const typed = parsed.links.find((l) => l.target === 'Acme Corp');
  assert.equal(typed?.linkType, 'works_at');
  assert.ok(parsed.links.some((l) => l.target === 'Plain' && !l.linkType));
});
