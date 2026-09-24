import { register } from 'node:module';
import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// Register TypeScript / TSX loader hook for Node ESM
register(new URL('./helpers/tsx-loader.js', import.meta.url).href, import.meta.url);

// Initialize DOM environment for React 18 rendering
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:3000',
});

global.window = dom.window;
global.document = dom.window.document;
try {
  Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
    writable: true,
  });
} catch (_) {}
global.HTMLElement = dom.window.HTMLElement;
global.HTMLInputElement = dom.window.HTMLInputElement;
global.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
global.HTMLButtonElement = dom.window.HTMLButtonElement;
global.HTMLSelectElement = dom.window.HTMLSelectElement;
global.Event = dom.window.Event;
global.CustomEvent = dom.window.CustomEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.MouseEvent = dom.window.MouseEvent;
global.Node = dom.window.Node;
global.File = dom.window.File;
global.requestAnimationFrame = (cb) => setTimeout(cb, 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);

// Stub localStorage
const storageMap = new Map();
global.localStorage = {
  getItem: (key) => storageMap.get(key) ?? null,
  setItem: (key, val) => storageMap.set(key, String(val)),
  removeItem: (key) => storageMap.delete(key),
  clear: () => storageMap.clear(),
};

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function setInputValue(element, value) {
  let proto = Object.getPrototypeOf(element);
  let setter;
  while (proto && !setter) {
    setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    proto = Object.getPrototypeOf(proto);
  }
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new global.window.Event('input', { bubbles: true }));
  element.dispatchEvent(new global.window.Event('change', { bubbles: true }));
}

// Dynamic imports of React and components via registered TSX loader
const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
const { MarkdownEditor } = await import('../src/components/editor/MarkdownEditor.tsx');

const editorSource = readFileSync(new URL('../src/components/editor/MarkdownEditor.tsx', import.meta.url), 'utf8');
const editorCss = readFileSync(new URL('../src/styles/editor.css', import.meta.url), 'utf8');

describe('Autosave Contract & Source Guardrails', () => {
  test('Autosave: MarkdownEditor implements debounced auto-saving', () => {
    assert.match(editorSource, /autoSaveTimerRef/);
    assert.match(editorSource, /handleSaveDocument\(true,\s*true\)/);
    assert.match(editorSource, /1500\);/);
  });

  test('Autosave: supports user toggle with localStorage persistence', () => {
    assert.match(editorSource, /tkxel_vault_autosave_enabled/);
    assert.match(editorSource, /autoSaveEnabled/);
    assert.match(editorSource, /Autosave on/);
    assert.match(editorSource, /Autosave off/);
    assert.match(editorSource, /Disable Autosave/);
    assert.match(editorSource, /Enable Autosave/);
  });

  test('Autosave: supports Ctrl+S and Cmd+S keyboard shortcut', () => {
    assert.match(editorSource, /\(e\.ctrlKey\s*\|\|\s*e\.metaKey\)\s*&&\s*e\.key\.toLowerCase\(\)\s*===\s*'s'/);
    assert.match(editorSource, /e\.preventDefault\(\)/);
    assert.match(editorSource, /handleSaveDocument\(true,\s*false\)/);
  });

  test('Autosave: provides visual feedback and maintains UI contracts', () => {
    assert.match(editorSource, /isAutoSaving/);
    assert.match(editorSource, /Saving\.\.\./);
    assert.match(editorSource, /lastSavedAt/);
    assert.match(editorCss, /\.markdown-editor__save-state\[data-state='saving'\]/);
    assert.match(editorCss, /\.spin-animate/);

    assert.match(editorSource, /Unsaved draft/);
    assert.match(editorSource, /Draft saved/);
    assert.match(editorSource, /Offline — changes stay here/);
    assert.match(editorSource, /Save Draft/);
    assert.match(editorSource, /Publish/);
  });
});

describe('Autosave Live Component & Timing Runtime Tests', () => {
  let container;
  let root;

  const mockPage = {
    id: '11111111-1111-1111-1111-000000000001',
    vault_id: 'vault-test-01',
    title: 'Autosave Initial Title',
    content: '# Autosave Note\n\nThis note tests real autosave timers.',
    tags: ['test'],
    type: 'note',
    created_at: new Date(),
  };

  beforeEach(() => {
    storageMap.clear();
    // Default: autosave is enabled
    storageMap.set('tkxel_vault_autosave_enabled', 'true');
    storageMap.set('tkxel_vault_ai_enabled', 'false');
    document.body.innerHTML = '<div id="root"></div>';
    container = document.getElementById('root');
    root = createRoot(container);
  });

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root.unmount();
      });
      root = null;
    }
    document.body.innerHTML = '';
    storageMap.clear();
  });

  test('Autosave triggers automatically 1500ms after edit and calls onSave without button click', async () => {
    let saveCount = 0;
    let lastSavedPayload = null;
    let lastIsDraft = null;

    const mockSave = async (data, isDraft) => {
      saveCount++;
      lastSavedPayload = data;
      lastIsDraft = isDraft;
      return true;
    };

    await act(async () => {
      root.render(
        React.createElement(MarkdownEditor, {
          page: mockPage,
          availablePages: [mockPage],
          timelineEntries: [],
          backlinks: [],
          canEdit: true,
          currentRole: 'owner',
          onSave: mockSave,
          onAddTimelineEntry: () => {},
          onNavigateToPage: () => {},
        })
      );
      await new Promise((r) => setTimeout(r, 60));
    });

    const titleInput = container.querySelector('#markdown-note-title');
    assert.ok(titleInput, 'Title input must exist');

    // Make an edit
    await act(async () => {
      setInputValue(titleInput, 'Autosave Updated Title');
    });

    // Verify draft state immediately
    const saveBadge = container.querySelector('.markdown-editor__save-state');
    assert.ok(saveBadge.textContent.includes('Unsaved draft'), 'Must show Unsaved draft immediately after edit');
    assert.equal(saveCount, 0, 'onSave must NOT be called immediately');

    // Advance 500ms (before 1500ms debounce)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 500));
    });
    assert.equal(saveCount, 0, 'onSave must NOT be called at 500ms');

    // Advance past 1500ms debounce threshold
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1200));
    });

    assert.equal(saveCount, 1, 'onSave must be called exactly once after 1500ms debounce');
    assert.equal(lastSavedPayload.title, 'Autosave Updated Title');
    assert.equal(lastIsDraft, true, 'Autosave must save as draft');
    assert.ok(saveBadge.textContent.includes('Draft saved'), 'Must show Draft saved confirmation after autosave');
  });

  test('Rapid typing resets debounce timer and only fires 1500ms after the last stroke', async () => {
    let saveCount = 0;
    const mockSave = async (data, isDraft) => {
      saveCount++;
      return true;
    };

    await act(async () => {
      root.render(
        React.createElement(MarkdownEditor, {
          page: mockPage,
          availablePages: [mockPage],
          timelineEntries: [],
          backlinks: [],
          canEdit: true,
          currentRole: 'owner',
          onSave: mockSave,
          onAddTimelineEntry: () => {},
          onNavigateToPage: () => {},
        })
      );
      await new Promise((r) => setTimeout(r, 60));
    });

    const titleInput = container.querySelector('#markdown-note-title');

    // First stroke at t=0
    await act(async () => {
      setInputValue(titleInput, 'Title Stroke 1');
    });

    // Wait 800ms
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800));
    });
    assert.equal(saveCount, 0, 'Must not save yet at 800ms');

    // Second stroke at t=800ms
    await act(async () => {
      setInputValue(titleInput, 'Title Stroke 2 (Final)');
    });

    // Wait another 800ms (t=1600ms total, but only 800ms since stroke 2)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 800));
    });
    assert.equal(saveCount, 0, 'Debounce must reset: must not save 800ms after stroke 2');

    // Wait remaining 900ms (1700ms since stroke 2)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
    assert.equal(saveCount, 1, 'Must save once after 1500ms has elapsed since the LAST stroke');
  });

  test('Ctrl+S / Cmd+S triggers immediate save without waiting for 1500ms debounce', async () => {
    let saveCount = 0;
    let savedPayload = null;

    const mockSave = async (data, isDraft) => {
      saveCount++;
      savedPayload = data;
      return true;
    };

    await act(async () => {
      root.render(
        React.createElement(MarkdownEditor, {
          page: mockPage,
          availablePages: [mockPage],
          timelineEntries: [],
          backlinks: [],
          canEdit: true,
          currentRole: 'owner',
          onSave: mockSave,
          onAddTimelineEntry: () => {},
          onNavigateToPage: () => {},
        })
      );
      await new Promise((r) => setTimeout(r, 60));
    });

    const titleInput = container.querySelector('#markdown-note-title');
    await act(async () => {
      setInputValue(titleInput, 'Keyboard Shortcut Title');
    });

    assert.equal(saveCount, 0);

    // Fire Ctrl+S keydown event
    await act(async () => {
      const keyEvent = new global.window.KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      global.window.dispatchEvent(keyEvent);
      await new Promise((r) => setTimeout(r, 60));
    });

    assert.equal(saveCount, 1, 'Ctrl+S must trigger save immediately');
    assert.equal(savedPayload.title, 'Keyboard Shortcut Title');
  });

  test('Toggling Autosave off prevents automatic saving, and re-enabling resumes it', async () => {
    let saveCount = 0;
    const mockSave = async () => {
      saveCount++;
      return true;
    };

    await act(async () => {
      root.render(
        React.createElement(MarkdownEditor, {
          page: mockPage,
          availablePages: [mockPage],
          timelineEntries: [],
          backlinks: [],
          canEdit: true,
          currentRole: 'owner',
          onSave: mockSave,
          onAddTimelineEntry: () => {},
          onNavigateToPage: () => {},
        })
      );
      await new Promise((r) => setTimeout(r, 60));
    });

    // Find Autosave toggle button
    const toggleBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent.includes('Autosave')
    );
    assert.ok(toggleBtn, 'Autosave toggle button must exist');
    assert.ok(toggleBtn.textContent.includes('Autosave on'));

    // Click to toggle off
    await act(async () => {
      toggleBtn.click();
    });
    assert.ok(toggleBtn.textContent.includes('Autosave off'));
    assert.equal(global.localStorage.getItem('tkxel_vault_autosave_enabled'), 'false');

    // Type while autosave is off
    const titleInput = container.querySelector('#markdown-note-title');
    await act(async () => {
      setInputValue(titleInput, 'Title With Autosave Disabled');
    });

    // Wait 2000ms
    await act(async () => {
      await new Promise((r) => setTimeout(r, 2000));
    });
    assert.equal(saveCount, 0, 'Must NOT autosave when autosave is disabled');

    // Re-enable autosave
    await act(async () => {
      toggleBtn.click();
    });
    assert.ok(toggleBtn.textContent.includes('Autosave on'));
    assert.equal(global.localStorage.getItem('tkxel_vault_autosave_enabled'), 'true');

    // Type again
    await act(async () => {
      setInputValue(titleInput, 'Title With Autosave Re-enabled');
    });

    // Wait 1700ms
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1700));
    });
    assert.equal(saveCount, 1, 'Must autosave after being re-enabled');
  });

  test('Failed autosave transitions badge to "Save failed" and keeps isDirty true', async () => {
    const mockFailingSave = async () => {
      return false; // Server rejected or network failed
    };

    await act(async () => {
      root.render(
        React.createElement(MarkdownEditor, {
          page: mockPage,
          availablePages: [mockPage],
          timelineEntries: [],
          backlinks: [],
          canEdit: true,
          currentRole: 'owner',
          onSave: mockFailingSave,
          onAddTimelineEntry: () => {},
          onNavigateToPage: () => {},
        })
      );
      await new Promise((r) => setTimeout(r, 60));
    });

    const titleInput = container.querySelector('#markdown-note-title');
    await act(async () => {
      setInputValue(titleInput, 'Failing Save Title');
    });

    // Wait 1700ms for autosave to fire and fail
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1700));
    });

    const saveBadge = container.querySelector('.markdown-editor__save-state');
    assert.ok(saveBadge.textContent.includes('Save failed'), 'Must show Save failed indicator on rejection');
    assert.equal(saveBadge.getAttribute('data-state'), 'error');
  });
});
