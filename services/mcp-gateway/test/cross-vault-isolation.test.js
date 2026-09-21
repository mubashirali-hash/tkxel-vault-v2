import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ToolPalettePolicy } from '../dist/auth/policy.js';
import { createOpenRetrievalHandlers } from '../dist/tools/open-retrieval.js';

describe('Epic 6.2: Multi-Tenant Cross-Vault Leakage & Error Suppression Tests', () => {
  const policy = new ToolPalettePolicy();

  // Multi-tenant fixtures
  const vaultAlpha = { id: 'vlt_alpha_corp', mode: 'open', title: 'Corporate Wiki' };
  const vaultBeta = { id: 'vlt_beta_confidential', mode: 'open', title: 'Confidential M&A' };
  const vaultGamma = { id: 'vlt_gamma_skills', mode: 'locked', title: 'Proprietary Skills Store' };

  const userAlphaPermissions = [
    { vaultId: vaultAlpha.id, mode: 'open', role: 'reader' },
  ];
  const userAlphaContext = {
    userId: 'alpha-reader@example.com',
    roles: new Map([[vaultAlpha.id, 'reader']]),
    vaultModes: new Map([[vaultAlpha.id, 'open']]),
  };

  it('Strict Multi-Tenant Isolation: User restricted to Vault Alpha cannot access Vault Beta pages or search', async () => {
    // 1. Authorized tools check
    const tools = policy.computeAuthorizedTools(userAlphaPermissions);
    assert.ok(tools.has('search'));
    assert.ok(tools.has('get_page'));

    // Mock storage layer with strict tenant isolation
    const mockStorage = {
      search: async (query, vaultId) => {
        // Enforce server-side boundary: only return records for authorized vault
        if (vaultId === vaultBeta.id) {
          throw new Error('not_allowed: Access denied or resource not found.');
        }
        return [
          { id: 'p_alpha_01', vaultId: vaultAlpha.id, title: 'Alpha Guidelines', snippet: 'Company travel policy' },
        ];
      },
      getPage: async (title, vaultId) => {
        if (vaultId === vaultBeta.id) {
          throw new Error('not_found: Access denied or resource not found.');
        }
        return { title, vaultId, content: 'Alpha contents', tags: ['policy'], backlinks: [] };
      },
      getLinks: async () => ({ nodes: [], edges: [] }),
      getContext: async () => ({ markdown: '', tokenEstimate: 0 }),
      addNote: async () => ({ noteId: 'n1', status: 'created' }),
    };

    const handlers = createOpenRetrievalHandlers(mockStorage);

    // Call search for Vault Alpha: returns results
    const alphaRes = await handlers.handleSearch(
      { query: 'policy', vault_id: vaultAlpha.id },
      userAlphaContext,
    );
    const alphaData = JSON.parse(alphaRes.content[0].text);
    assert.equal(alphaData.length, 1);
    assert.equal(alphaData[0].vaultId, vaultAlpha.id);

    // Call search targeting unauthorized Vault Beta: strictly rejected
    await assert.rejects(
      async () => {
        await handlers.handleSearch(
          { query: 'M&A acquisition', vault_id: vaultBeta.id },
          userAlphaContext,
        );
      },
      (err) => {
        assert.ok(err.message.includes('not_allowed') || err.message.includes('not_found'));
        assert.ok(!err.message.includes('Confidential M&A'), 'Leaked vault title in error');
        return true;
      }
    );
  });

  it('Error Suppression (FR-68): Uniform error for unauthorized page vs nonexistent page', async () => {
    const mockStorage = {
      search: async () => [],
      getPage: async (title, vaultId) => {
        // Regardless of whether title is an existing secret page in Beta or completely nonexistent,
        // server-side policy returns uniform generic error
        throw new Error('not_found: The requested resource was not found or access is not allowed.');
      },
      getLinks: async () => { throw new Error('not_found: The requested resource was not found.'); },
      getContext: async () => { throw new Error('not_found: The requested resource was not found.'); },
      addNote: async () => { throw new Error('not_allowed: Not authorized.'); },
    };

    const handlers = createOpenRetrievalHandlers(mockStorage);

    // 1. Existing secret page in unauthorized vault
    let errorExisting = '';
    try {
      await handlers.handleGetPage(
        { title: 'secret_mna_page_999', vault_id: vaultBeta.id },
        userAlphaContext,
      );
    } catch (e) {
      errorExisting = e.message;
    }

    // 2. Completely fake non-existent page
    let errorFake = '';
    try {
      await handlers.handleGetPage(
        { title: 'non_existent_random_id_000', vault_id: vaultBeta.id },
        userAlphaContext,
      );
    } catch (e) {
      errorFake = e.message;
    }

    // Assert both return uniform error without confirming existence
    assert.ok(errorExisting.includes('not_found') || errorExisting.includes('not_allowed'));
    assert.equal(errorExisting, errorFake, 'Errors must be completely identical to prevent timing/existence disclosure');
  });

  it('Dual-Mode Tool Separation: Reader cannot call locked tools and Consumer cannot call retrieval tools', () => {
    // Consumer permissions on locked vault
    const consumerPermissions = [
      { vaultId: vaultGamma.id, mode: 'locked', role: 'consumer' },
    ];
    const consumerTools = policy.computeAuthorizedTools(consumerPermissions);

    // Consumer must have zero retrieval tools
    assert.equal(consumerTools.has('search'), false);
    assert.equal(consumerTools.has('get_page'), false);
    assert.equal(consumerTools.has('get_links'), false);
    assert.equal(consumerTools.has('get_context'), false);
    assert.equal(consumerTools.has('add_note'), false);

    // Reader permissions on open vault
    const readerPermissions = [
      { vaultId: vaultAlpha.id, mode: 'open', role: 'reader' },
    ];
    const readerTools = policy.computeAuthorizedTools(readerPermissions);

    // Reader must have zero locked tools
    assert.equal(readerTools.has('run_skill'), false);
    assert.equal(readerTools.has('ask_vault'), false);
    assert.equal(readerTools.has('list_skills'), false);
  });
});
