import test from 'node:test';
import assert from 'node:assert/strict';

import { createLockedRetrievalHandlers } from '../dist/tools/locked-tools.js';

const LOCKED_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LOCKED_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const consumerContext = {
  userId: 'consumer@example.com',
  roles: new Map([[LOCKED_A, 'consumer']]),
  vaultModes: new Map([[LOCKED_A, 'locked']]),
};

test('locked tools reject an unauthorized exact vault before database or runner access', async () => {
  const handlers = createLockedRetrievalHandlers();

  await assert.rejects(
    handlers.handleRunSkill(
      { vault_id: LOCKED_B, skill_name: 'secret-skill', arguments: {} },
      consumerContext,
    ),
    { message: 'not_allowed' },
  );

  await assert.rejects(
    handlers.handleAskVault(
      { vault_id: LOCKED_B, query: 'What is inside?' },
      consumerContext,
    ),
    { message: 'not_allowed' },
  );
});

test('locked tools require an explicit vault identifier', async () => {
  const handlers = createLockedRetrievalHandlers();

  await assert.rejects(
    handlers.handleRunSkill({ skill_name: 'secret-skill', arguments: {} }, consumerContext),
    { message: 'not_allowed' },
  );

  await assert.rejects(
    handlers.handleAskVault({ query: 'What is inside?' }, consumerContext),
    { message: 'not_allowed' },
  );

  await assert.rejects(
    handlers.handleListSkills({}, consumerContext),
    { message: 'not_allowed' },
  );
});

test('locked tools reject an open vault even when caller has a role there', async () => {
  const handlers = createLockedRetrievalHandlers();
  const openOwnerContext = {
    userId: 'owner@example.com',
    roles: new Map([[LOCKED_A, 'owner']]),
    vaultModes: new Map([[LOCKED_A, 'open']]),
  };

  await assert.rejects(
    handlers.handleRunSkill(
      { vault_id: LOCKED_A, skill_name: 'secret-skill', arguments: {} },
      openOwnerContext,
    ),
    { message: 'not_allowed' },
  );
});

