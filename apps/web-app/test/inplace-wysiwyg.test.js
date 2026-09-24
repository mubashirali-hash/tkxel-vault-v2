import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const editorSource = readFileSync(new URL('../src/components/editor/MarkdownEditor.tsx', import.meta.url), 'utf8');
const codeBlockSource = readFileSync(new URL('../src/components/editor/CodeBlockComponent.tsx', import.meta.url), 'utf8');
const indexCss = readFileSync(new URL('../src/styles/index.css', import.meta.url), 'utf8');

test('In-Place WYSIWYG: MarkdownEditor registers Table extensions and CustomCodeBlock', () => {
  // Verifies Table suite is registered in TipTap
  assert.match(editorSource, /import \{ Table, TableRow, TableHeader, TableCell \} from '@tiptap\/extension-table'/);
  assert.match(editorSource, /CustomCodeBlock/);
  assert.match(editorSource, /Table\.configure/);
  assert.match(editorSource, /TableRow/);
  assert.match(editorSource, /TableHeader/);
  assert.match(editorSource, /TableCell/);
});

test('In-Place WYSIWYG: MarkdownEditor is 100% single-window with no preview tabs', () => {
  // Asserts there is NO separate preview tab or toggle state
  assert.doesNotMatch(editorSource, /const \[isPreview, setIsPreview\]/);
  assert.doesNotMatch(editorSource, /markdown-editor__mode-toggle/);
  assert.doesNotMatch(editorSource, /<MarkdownPreview/);
  // Verifies single EditorContent canvas
  assert.match(editorSource, /<EditorContent editor=\{editor\} \/>/);
});

test('In-Place WYSIWYG: MarkdownEditor provides Table insertion in toolbar and menu', () => {
  assert.match(editorSource, /insertTable/);
  assert.match(editorSource, /TableIcon/);
  assert.match(editorSource, /label: 'Data table'/);
});

test('In-Place WYSIWYG: CodeBlockComponent renders Mermaid diagrams in-place with toggleable edit tray', () => {
  assert.match(codeBlockSource, /isMermaid/);
  assert.match(codeBlockSource, /inplace-mermaid-nodeview/);
  assert.match(codeBlockSource, /inplace-mermaid__diagram-surface/);
  assert.match(codeBlockSource, /inplace-mermaid__edit-tray/);
  assert.match(codeBlockSource, /Edit Diagram/);
  assert.match(codeBlockSource, /Done/);
  assert.match(codeBlockSource, /NodeViewContent/);
  assert.match(codeBlockSource, /CustomCodeBlock = CodeBlock\.extend/);
});

test('In-Place WYSIWYG: Strict monospace & ASCII diagram styling aligns box-drawing characters', () => {
  // Table styling
  assert.match(indexCss, /\.tiptap table/);
  assert.match(indexCss, /\.tiptap th/);
  assert.match(indexCss, /\.tiptap td/);
  // ASCII diagram strict monospace rules (line-height 1.25, Cascadia Code / Consolas)
  assert.match(indexCss, /line-height: 1\.25/);
  assert.match(indexCss, /'Cascadia Code', 'Fira Code', 'Consolas'/);
  // In-place Mermaid styling
  assert.match(indexCss, /\.inplace-mermaid-nodeview/);
  assert.match(indexCss, /\.inplace-mermaid__svg-canvas/);
});
