import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAnomalies, withAnomalyDetection, DEFAULT_ANOMALY_CONFIG } from '../dist/audit/anomaly.js';

const event = (overrides = {}) => ({
  userId: 'Alice@tkxel.com',
  tool: 'search',
  vaultId: null,
  targetId: null,
  status: 'success',
  requestBytes: 10,
  responseBytes: 10,
  ...overrides,
});

test('FR-83: volume alert fires above 3x the normal hourly volume, with a floor for new users', () => {
  const kinds = (stats) => evaluateAnomalies('u', stats).map((a) => a.kind);

  // Established user: normal 40/hr
  assert.deepEqual(kinds({ callsLastHour: 120, baselineHourlyCalls: 40, denialsLast10Min: 0 }), []);
  assert.deepEqual(kinds({ callsLastHour: 121, baselineHourlyCalls: 40, denialsLast10Min: 0 }), ['volume_spike']);

  // New user with no history: floor of 10/hr applies, so a normal first session is quiet
  assert.deepEqual(kinds({ callsLastHour: 30, baselineHourlyCalls: 0, denialsLast10Min: 0 }), []);
  assert.deepEqual(kinds({ callsLastHour: 31, baselineHourlyCalls: 0, denialsLast10Min: 0 }), ['volume_spike']);

  assert.equal(DEFAULT_ANOMALY_CONFIG.volumeMultiplier, 3);
});

test('FR-83: repeated authorization denials raise an alert', () => {
  const kinds = (denials) =>
    evaluateAnomalies('u', { callsLastHour: 6, baselineHourlyCalls: 20, denialsLast10Min: denials }).map((a) => a.kind);
  assert.deepEqual(kinds(4), []);
  assert.deepEqual(kinds(5), ['repeated_denials']);

  const both = evaluateAnomalies('u', { callsLastHour: 500, baselineHourlyCalls: 20, denialsLast10Min: 9 });
  assert.deepEqual(both.map((a) => a.kind), ['volume_spike', 'repeated_denials']);
  assert.equal(both[0].detail.calls_last_hour, 500);
});

test('FR-83: detection runs after the audit write, de-duplicates alerts and never fails the tool call', async () => {
  const order = [];
  const raised = [];
  let stats = { callsLastHour: 5, baselineHourlyCalls: 20, denialsLast10Min: 0 };
  let alreadyAlerted = false;
  let failStats = false;
  let clock = 1_000_000;

  const sink = withAnomalyDetection(
    async () => {
      order.push('audit');
    },
    {
      getStats: async () => {
        order.push('stats');
        if (failStats) throw new Error('db down');
        return stats;
      },
      recentlyAlerted: async () => alreadyAlerted,
      raise: async (alert) => {
        raised.push(alert);
      },
    },
    { minIntervalMs: 30_000, now: () => clock }
  );

  await sink(event());
  assert.deepEqual(order, ['audit', 'stats'], 'the audit record is always written first');
  assert.equal(raised.length, 0);

  // Successful calls are sampled: a second call inside the interval is audited but not re-evaluated
  order.length = 0;
  await sink(event());
  assert.deepEqual(order, ['audit']);

  // A denial is always evaluated
  order.length = 0;
  stats = { callsLastHour: 8, baselineHourlyCalls: 20, denialsLast10Min: 5 };
  await sink(event({ status: 'denied' }));
  assert.deepEqual(order, ['audit', 'stats']);
  assert.equal(raised.length, 1);
  assert.equal(raised[0].kind, 'repeated_denials');
  assert.equal(raised[0].userId, 'Alice@tkxel.com');

  // Already alerted within the hour -> no duplicate
  alreadyAlerted = true;
  await sink(event({ status: 'denied' }));
  assert.equal(raised.length, 1);

  // Backend failure is contained
  failStats = true;
  clock += 60_000;
  await assert.doesNotReject(() => sink(event()));
});
