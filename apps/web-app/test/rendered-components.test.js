import { register } from 'node:module';
import test, { describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
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
const { CreateVaultModal } = await import('../src/components/vault/CreateVaultModal.tsx');
const { MoveToVaultModal } = await import('../src/components/vault/MoveToVaultModal.tsx');
const { ConvertNoteToSkillModal } = await import('../src/components/skills/ConvertNoteToSkillModal.tsx');
const { ImporterModal } = await import('../src/components/ingestion/ImporterModal.tsx');
const { ExportModal } = await import('../src/components/export/ExportModal.tsx');
const { AppShell } = await import('../src/components/layout/AppShell.tsx');
const {
  createVaultApi,
  movePageApi,
  processImportPages,
  buildExportZipPackage,
} = await import('../src/operations/index.js');

// Test fixtures
const mockOpenVault = {
  id: 'vault-open-01',
  name: 'Engineering Knowledge Base',
  mode: 'open',
  owner_id: 'alex.dev@tkxel.com',
  data_key_id: 'kms_key_01',
  export_policy: 'allowed_for_owner',
  created_at: new Date('2026-01-01'),
};

const mockLockedVault = {
  id: 'vault-locked-02',
  name: 'Proprietary IP Store',
  mode: 'locked',
  owner_id: 'admin@tkxel.com',
  data_key_id: 'kms_key_02',
  export_policy: 'strictly_forbidden',
  created_at: new Date('2026-01-01'),
};

describe('Rendered React Components: Epic 4 Frontend Content-Model & Invariants', () => {
  let container;
  let root;

  beforeEach(() => {
    storageMap.clear();
    storageMap.set('tkxel_vault_ai_enabled', 'false');
    storageMap.set('tkxel_vault_autosave_enabled', 'false');
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

  // =========================================================================
  // 1. MarkdownEditor: Loading, Prop Switching, Autosave/Publish Indicators
  // =========================================================================
  describe('MarkdownEditor Rendered Invariants', () => {
    test('MarkdownEditor: initial load renders title and body strictly from Page.content', async () => {
      const note = {
        id: 'note-arch-01',
        vault_id: mockOpenVault.id,
        title: 'Architecture Blueprint',
        content: '# Architecture Blueprint\n\nActive operational markdown document.',
        front_matter: {
          title: 'Architecture Blueprint',
          body: 'STALE_LEGACY_BODY_DO_NOT_RENDER',
        },
        tags: ['arch'],
        type: 'architecture',
        created_at: new Date(),
      };

      await act(async () => {
        root.render(
          React.createElement(MarkdownEditor, {
            page: note,
            availablePages: [note],
            timelineEntries: [],
            backlinks: [],
            canEdit: true,
            currentRole: 'owner',
            onSave: () => {},
            onAddTimelineEntry: () => {},
            onNavigateToPage: () => {},
          })
        );
        await new Promise((r) => setTimeout(r, 60));
      });

      const titleInput = container.querySelector('#markdown-note-title');
      assert.ok(titleInput, 'Document title input must be rendered in DOM');
      assert.equal(titleInput.value, 'Architecture Blueprint');

      const editorText = container.textContent;
      assert.ok(editorText.includes('Architecture Blueprint'));
      assert.ok(
        editorText.includes('Active operational markdown document') ||
          container.querySelector('.ProseMirror')?.textContent.includes('Active operational markdown document'),
        'Operational Page.content must be rendered in the DOM workspace'
      );
      assert.equal(
        editorText.includes('STALE_LEGACY_BODY_DO_NOT_RENDER'),
        false,
        'Legacy front_matter.body must NEVER be rendered in editor'
      );
    });

    test('MarkdownEditor: switching the page prop updates the editor content', async () => {
      const page1 = {
        id: 'note-switch-1',
        vault_id: mockOpenVault.id,
        title: 'Initial Note',
        content: '# Initial Note\n\nFirst note body content.',
        front_matter: { title: 'Initial Note' },
        tags: [],
        type: 'note',
        created_at: new Date(),
      };

      const page2 = {
        id: 'note-switch-2',
        vault_id: mockOpenVault.id,
        title: 'Switched Target Note',
        content: '# Switched Target Note\n\nSecond note body after switch.',
        front_matter: { title: 'Switched Target Note' },
        tags: [],
        type: 'note',
        created_at: new Date(),
      };

      await act(async () => {
        root.render(
          React.createElement(MarkdownEditor, {
            page: page1,
            availablePages: [page1, page2],
            timelineEntries: [],
            backlinks: [],
            canEdit: true,
            currentRole: 'owner',
            onSave: () => {},
            onAddTimelineEntry: () => {},
            onNavigateToPage: () => {},
          })
        );
        await new Promise((r) => setTimeout(r, 60));
      });

      const titleInput = container.querySelector('#markdown-note-title');
      assert.equal(titleInput.value, 'Initial Note');

      // Switch page prop to page2
      await act(async () => {
        root.render(
          React.createElement(MarkdownEditor, {
            page: page2,
            availablePages: [page1, page2],
            timelineEntries: [],
            backlinks: [],
            canEdit: true,
            currentRole: 'owner',
            onSave: () => {},
            onAddTimelineEntry: () => {},
            onNavigateToPage: () => {},
          })
        );
        await new Promise((r) => setTimeout(r, 60));
      });

      assert.equal(titleInput.value, 'Switched Target Note');
      const editorText = container.textContent;
      assert.ok(editorText.includes('Switched Target Note'));
    });

    test('MarkdownEditor: autosave/publish success displays saved indicator', async () => {
      let savedData = null;
      const mockSave = async (data, isDraft) => {
        savedData = data;
        return true; // Confirmed success
      };

      const page = {
        id: 'note-save-1',
        vault_id: mockOpenVault.id,
        title: 'Autosave Note',
        content: '# Content before edit',
        front_matter: { title: 'Autosave Note' },
        tags: [],
        type: 'note',
        created_at: new Date(),
      };

      await act(async () => {
        root.render(
          React.createElement(MarkdownEditor, {
            page,
            availablePages: [page],
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

      // Modify title to make document dirty
      const titleInput = container.querySelector('#markdown-note-title');
      await act(async () => {
        setInputValue(titleInput, 'Autosave Note (Dirty)');
      });

      // Verify save state indicator is draft
      const saveStateEl = container.querySelector('.markdown-editor__save-state');
      assert.equal(saveStateEl.getAttribute('data-state'), 'draft');

      // Click Save Draft button
      const buttons = Array.from(container.querySelectorAll('button'));
      const saveDraftBtn = buttons.find((b) => b.textContent.includes('Save Draft'));
      assert.ok(saveDraftBtn, 'Save Draft button should be present in actions');

      await act(async () => {
        saveDraftBtn.click();
        await new Promise((r) => setTimeout(r, 60));
      });

      assert.ok(savedData, 'onSave callback must be invoked');
      assert.equal(savedData.title, 'Autosave Note (Dirty)');
      assert.equal(saveStateEl.getAttribute('data-state'), 'saved');
      assert.ok(saveStateEl.textContent.includes('Draft saved'));

      // Flush feedback indicator timer (1500ms) inside act to prevent leaking state updates
      await act(async () => {
        await new Promise((r) => setTimeout(r, 1600));
      });
    });

    test('MarkdownEditor: failed save does not display a saved/success state and surfaces error indicator', async () => {
      const mockFailingSave = async () => {
        return false; // Cloud save failed
      };

      const page = {
        id: 'note-fail-1',
        vault_id: mockOpenVault.id,
        title: 'Failure Test Note',
        content: '# Original text',
        front_matter: { title: 'Failure Test Note' },
        tags: [],
        type: 'note',
        created_at: new Date(),
      };

      await act(async () => {
        root.render(
          React.createElement(MarkdownEditor, {
            page,
            availablePages: [page],
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
        setInputValue(titleInput, 'Failure Test Note (Modified)');
      });

      const buttons = Array.from(container.querySelectorAll('button'));
      const saveDraftBtn = buttons.find((b) => b.textContent.includes('Save Draft'));

      await act(async () => {
        saveDraftBtn.click();
        await new Promise((r) => setTimeout(r, 60));
      });

      const saveStateEl = container.querySelector('.markdown-editor__save-state');
      // Critical security and UX invariant: failed save MUST NOT show saved state
      assert.notEqual(saveStateEl.getAttribute('data-state'), 'saved');
      assert.equal(saveStateEl.getAttribute('data-state'), 'error');
      assert.ok(saveStateEl.textContent.includes('Save failed'));
      assert.equal(saveStateEl.textContent.includes('Draft saved'), false);
    });
  });

  // =========================================================================
  // 2. Vault Creation & Page Movement Modals (Action Boundary Verification)
  // =========================================================================
  describe('Server-Confirmed Action Boundary Invariants', () => {
    test('CreateVaultModal: surfaces server error in DOM alert and keeps modal open', async () => {
      let closed = false;
      const failingFetch = async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Database constraint violation: duplicate vault name' }),
      });

      const handleCreate = async (data) => {
        await createVaultApi(data, { fetchImpl: failingFetch });
      };

      await act(async () => {
        root.render(
          React.createElement(CreateVaultModal, {
            isOpen: true,
            onClose: () => { closed = true; },
            onCreateVault: handleCreate,
          })
        );
      });

      const input = container.querySelector('input[type="text"]');
      assert.ok(input, 'Vault name input should be rendered');

      await act(async () => {
        setInputValue(input, 'Duplicate Vault Name');
      });

      const submitButton = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent.includes('Create Vault')
      );
      assert.ok(submitButton, 'Create Vault submit button must be present');

      await act(async () => {
        submitButton.click();
        await new Promise((r) => setTimeout(r, 50));
      });

      assert.equal(closed, false, 'Modal must NOT close when server returns error');

      const alertEl =
        container.querySelector('[role="alert"]') || container.querySelector('.ui-alert--error');
      assert.ok(alertEl, 'DOM error alert must be rendered');
      assert.ok(
        alertEl.textContent.includes('duplicate vault name'),
        `Expected error message in alert, got: ${alertEl.textContent}`
      );
      assert.equal(input.value, 'Duplicate Vault Name', 'Form input must not be cleared on failure');
    });

    test('CreateVaultModal: on server success calls onClose and resets inputs', async () => {
      let closed = false;
      let createdVault = null;

      const successFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          vault: {
            id: 'vault-created-99',
            name: 'Public Documentation',
            mode: 'open',
            owner_id: 'alex.dev@tkxel.com',
            data_key_id: 'kms-01',
            export_policy: 'allowed_for_owner',
            created_at: new Date().toISOString(),
          },
        }),
      });

      const handleCreate = async (data) => {
        const vault = await createVaultApi(data, { fetchImpl: successFetch });
        createdVault = vault;
      };

      await act(async () => {
        root.render(
          React.createElement(CreateVaultModal, {
            isOpen: true,
            onClose: () => { closed = true; },
            onCreateVault: handleCreate,
          })
        );
      });

      const input = container.querySelector('input[type="text"]');
      await act(async () => {
        setInputValue(input, 'Public Documentation');
      });

      const submitButton = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent.includes('Create Vault')
      );

      await act(async () => {
        submitButton.click();
        await new Promise((r) => setTimeout(r, 50));
      });

      assert.equal(closed, true, 'Modal should close on server-confirmed success');
      assert.equal(createdVault?.id, 'vault-created-99');
      assert.equal(createdVault?.name, 'Public Documentation');
    });

    test('MoveToVaultModal: surfaces server error in DOM and does not close modal', async () => {
      let closed = false;
      const failingFetch = async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: 'KMS Key access denied for destination vault' }),
      });

      const handleMove = async (destId) => {
        await movePageApi('page-101', destId, { fetchImpl: failingFetch });
      };

      await act(async () => {
        root.render(
          React.createElement(MoveToVaultModal, {
            isOpen: true,
            onClose: () => { closed = true; },
            pageTitle: 'Sensitive Spec',
            pageId: 'page-101',
            currentVault: mockOpenVault,
            availableVaults: [mockOpenVault, mockLockedVault],
            onMovePage: handleMove,
          })
        );
      });

      const moveButton = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent.includes('Confirm Move')
      );
      assert.ok(moveButton, 'Confirm Move button should be present');

      await act(async () => {
        moveButton.click();
        await new Promise((r) => setTimeout(r, 50));
      });

      assert.equal(closed, false, 'Modal must NOT close when server returns error');

      const alertEl =
        container.querySelector('[role="alert"]') || container.querySelector('.ui-alert--error');
      assert.ok(alertEl, 'DOM error alert must be rendered');
      assert.ok(alertEl.textContent.includes('KMS Key access denied'));
    });

    test('MoveToVaultModal: on server success calls onClose', async () => {
      let closed = false;
      let targetDestId = null;

      const successFetch = async () => ({
        ok: true,
        status: 200,
      });

      const handleMove = async (destId) => {
        await movePageApi('page-202', destId, { fetchImpl: successFetch });
        targetDestId = destId;
      };

      await act(async () => {
        root.render(
          React.createElement(MoveToVaultModal, {
            isOpen: true,
            onClose: () => { closed = true; },
            pageTitle: 'Architecture Plan',
            pageId: 'page-202',
            currentVault: mockOpenVault,
            availableVaults: [mockOpenVault, mockLockedVault],
            onMovePage: handleMove,
          })
        );
      });

      const moveButton = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent.includes('Confirm Move')
      );

      await act(async () => {
        moveButton.click();
        await new Promise((r) => setTimeout(r, 50));
      });

      assert.equal(closed, true, 'Modal should close on server-confirmed success');
      assert.equal(targetDestId, mockLockedVault.id);
    });
  });

  // =========================================================================
  // 3. Note-to-Skill Conversion (ConvertNoteToSkillModal)
  // =========================================================================
  describe('Note-to-Skill Conversion Invariants', () => {
    test('ConvertNoteToSkillModal: populates system instructions strictly from Page.content', async () => {
      const noteToConvert = {
        id: 'note-skill-01',
        vault_id: mockOpenVault.id,
        title: 'Review PR Skill',
        type: 'skill',
        tags: ['github', 'review'],
        content: '# Review PR\n\nAutomated PR review prompt and schema instructions.',
        front_matter: {
          title: 'Review PR Skill',
          type: 'skill',
          tags: ['github', 'review'],
        },
        created_at: new Date(),
      };

      await act(async () => {
        root.render(
          React.createElement(ConvertNoteToSkillModal, {
            isOpen: true,
            onClose: () => {},
            note: noteToConvert,
            lockedVaults: [mockLockedVault],
            onConvert: () => {},
          })
        );
      });

      // Textareas: 0 = description, 1 = system instructions, 2 = schema
      const textareas = Array.from(container.querySelectorAll('textarea'));
      const instructionsTextarea = textareas[1];
      assert.ok(instructionsTextarea, 'System instructions textarea should be present');
      assert.ok(
        instructionsTextarea.value.includes('Automated PR review prompt and schema instructions.'),
        `Expected textarea value to reflect Page.content, got: ${instructionsTextarea.value}`
      );
    });

    test('ConvertNoteToSkillModal: prioritizes Page.content even if legacy front_matter.body exists', async () => {
      const noteWithStaleLegacyBody = {
        id: 'note-skill-02',
        vault_id: mockOpenVault.id,
        title: 'Deployment Helper',
        type: 'note',
        tags: ['ops'],
        content: '# Deployment Helper\n\nFresh operational content from Page.content.',
        front_matter: {
          title: 'Deployment Helper',
          body: '# Stale Body\n\nObsolete legacy body that should be ignored.',
        },
        created_at: new Date(),
      };

      await act(async () => {
        root.render(
          React.createElement(ConvertNoteToSkillModal, {
            isOpen: true,
            onClose: () => {},
            note: noteWithStaleLegacyBody,
            lockedVaults: [mockLockedVault],
            onConvert: () => {},
          })
        );
      });

      const textareas = Array.from(container.querySelectorAll('textarea'));
      const instructionsTextarea = textareas[1];
      assert.ok(instructionsTextarea.value.includes('Fresh operational content from Page.content.'));
      assert.equal(
        instructionsTextarea.value.includes('Obsolete legacy body'),
        false,
        'Legacy front_matter.body must NOT be used when Page.content is present'
      );
    });

    test('ConvertNoteToSkillModal: dispatches converted skill payload with instructions from Page.content', async () => {
      let convertedResult = null;
      const noteToConvert = {
        id: 'note-skill-03',
        vault_id: mockOpenVault.id,
        title: 'Sql Optimizer',
        type: 'skill',
        tags: ['db', 'sql'],
        content: 'Analyze SQL query execution plans and index usage.',
        front_matter: {
          title: 'Sql Optimizer',
          tool_schema: '{"type":"object","properties":{"query":{"type":"string"}}}',
        },
        created_at: new Date(),
      };

      await act(async () => {
        root.render(
          React.createElement(ConvertNoteToSkillModal, {
            isOpen: true,
            onClose: () => {},
            note: noteToConvert,
            lockedVaults: [mockLockedVault],
            onConvert: (res) => { convertedResult = res; },
          })
        );
      });

      const buttons = Array.from(container.querySelectorAll('button'));
      const convertButton = buttons.find((b) =>
        b.textContent.includes('Convert & Encrypt into Skills Store')
      );
      assert.ok(convertButton, 'Convert button should be present');

      await act(async () => {
        convertButton.click();
      });

      assert.ok(convertedResult, 'onConvert callback should be invoked');
      assert.equal(convertedResult.targetVaultId, mockLockedVault.id);
      assert.equal(convertedResult.skill.name, 'sql-optimizer');
      assert.equal(convertedResult.skill.system_instructions, 'Analyze SQL query execution plans and index usage.');
      assert.equal(convertedResult.skill.tool_schema, '{"type":"object","properties":{"query":{"type":"string"}}}');
    });
  });

  // =========================================================================
  // 4. Ingestion and Export UI with Production Pipelines
  // =========================================================================
  describe('Ingestion and Export UI Integration', () => {
    test('ImporterModal: renders and triggers onImportComplete calling production import pipeline', async () => {
      let pipelineResult = null;
      const existingPages = [
        { id: 'ex-1', title: 'System Architecture', content: '# System Architecture', front_matter: {} },
      ];

      const handleComplete = (result) => {
        pipelineResult = processImportPages(result, mockOpenVault.id, existingPages);
      };

      await act(async () => {
        root.render(
          React.createElement(ImporterModal, {
            isOpen: true,
            onClose: () => {},
            onImportComplete: handleComplete,
          })
        );
      });

      const modalHeading = container.querySelector('h3');
      assert.ok(modalHeading, 'Modal heading should be rendered');
      assert.ok(modalHeading.textContent.includes('Import Markdown'));

      // Supply an in-memory Markdown file containing legacy front_matter.body
      const legacyMarkdown = [
        '---',
        'title: Legacy Ingestion Note',
        'body: "# Recovered Markdown\\n\\nMigrated through import pipeline."',
        'type: note',
        'tags:',
        '  - import',
        '---',
      ].join('\n');

      const file = new dom.window.File([legacyMarkdown], 'Legacy Ingestion Note.md', {
        type: 'text/markdown',
      });

      const dropZone = container.querySelector('[aria-label="Choose Markdown files or a ZIP archive to import"]');
      assert.ok(dropZone, 'Drop zone element must be present in DOM');

      const dropEvent = new dom.window.Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(dropEvent, 'dataTransfer', {
        value: {
          files: [file],
        },
      });

      await act(async () => {
        dropZone.dispatchEvent(dropEvent);
        await new Promise((r) => setTimeout(r, 100));
      });

      // Find and click the rendered "Import to Vault" button
      const importButton = Array.from(container.querySelectorAll('button')).find((b) =>
        b.textContent.includes('Import to Vault')
      );
      assert.ok(importButton, 'Import to Vault button must be rendered');
      assert.equal(importButton.disabled, false, 'Import button should be enabled after files are parsed');

      await act(async () => {
        importButton.click();
      });

      assert.ok(pipelineResult, 'Production import pipeline should have executed via onImportComplete');
      assert.equal(pipelineResult.newPages.length, 1);
      const importedPage = pipelineResult.newPages[0];
      assert.ok(
        importedPage.content.includes('# Recovered Markdown') &&
          importedPage.content.includes('Migrated through import pipeline.'),
        `Expected content in importedPage.content, got: ${importedPage.content}`
      );
      assert.equal(importedPage.front_matter.body, undefined, 'Legacy body must be scrubbed from front_matter');
    });

    test('ExportModal: renders and triggers onConfirmExport calling production export packaging', async () => {
      let exportCalledWith = null;
      let packagedZip = null;

      const testPages = [
        {
          id: 'p-exp-1',
          vault_id: mockOpenVault.id,
          title: 'KMS Security Spec',
          content: '# KMS Security Spec\n\nVerified operational export content.',
          tags: ['security'],
          type: 'decision',
          front_matter: { title: 'KMS Security Spec' },
        },
      ];

      const handleExport = async (justification) => {
        exportCalledWith = justification;
        packagedZip = await buildExportZipPackage(testPages, mockOpenVault.id);
      };

      await act(async () => {
        root.render(
          React.createElement(ExportModal, {
            isOpen: true,
            vault: mockOpenVault,
            currentRole: 'owner',
            onClose: () => {},
            onConfirmExport: handleExport,
          })
        );
      });

      const textarea = container.querySelector('textarea');
      assert.ok(textarea, 'Justification textarea must be present');

      await act(async () => {
        setInputValue(textarea, 'Quarterly ISO compliance audit');
      });

      const form = container.querySelector('form');
      assert.ok(form, 'Export form must be present');

      await act(async () => {
        form.dispatchEvent(new global.window.Event('submit', { bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 50));
      });

      assert.equal(exportCalledWith, 'Quarterly ISO compliance audit');
      assert.ok(packagedZip, 'Zip package must be generated');
      assert.equal(packagedZip.fileCount, 1);
      assert.ok(packagedZip.files['KMS_Security_Spec.md'].includes('# KMS Security Spec'));
    });
  });

  // =========================================================================
  // 5. AppShell Vault Switching
  // =========================================================================
  describe('AppShell Vault Switching', () => {
    test('AppShell: vault switcher interaction triggers onSelectVault callback and updates current vault display', async () => {
      let selectedVault = mockOpenVault;

      const renderShell = (currentV) =>
        React.createElement(
          AppShell,
          {
            currentVault: currentV,
            vaults: [mockOpenVault, mockLockedVault],
            currentRole: 'owner',
            currentTab: 'editor',
            navigationOpen: true,
            navigationCollapsed: false,
            navigationAvailable: true,
            onToggleNavigation: () => {},
            onCloseNavigation: () => {},
            onSelectVault: (v) => {
              selectedVault = v;
            },
            onSelectTab: () => {},
            onOpenShareModal: () => {},
            onOpenExportModal: () => {},
            onOpenImportModal: () => {},
          },
          React.createElement('div', { id: 'test-content' }, `Current Vault: ${currentV.name}`)
        );

      await act(async () => {
        root.render(renderShell(mockOpenVault));
      });

      // Verify open vault rendered
      assert.ok(container.textContent.includes('Engineering Knowledge Base'));

      // Open vault dropdown menu
      const triggerBtn = container.querySelector('.app-vault-switcher__trigger');
      assert.ok(triggerBtn, 'Vault switcher trigger button must be present');

      await act(async () => {
        triggerBtn.click();
      });

      // Find locked vault button in dropdown
      const menuItems = Array.from(container.querySelectorAll('.app-vault-menu button'));
      const lockedVaultBtn = menuItems.find((b) => b.textContent.includes('Proprietary IP Store'));
      assert.ok(lockedVaultBtn, 'Locked vault menu item must be present');

      await act(async () => {
        lockedVaultBtn.click();
      });

      assert.equal(selectedVault.id, mockLockedVault.id);

      // Re-render AppShell with switched vault
      await act(async () => {
        root.render(renderShell(mockLockedVault));
      });

      assert.ok(container.textContent.includes('Proprietary IP Store'));
    });
  });
});
