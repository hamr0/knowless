import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  newHarness,
  fakeReq,
  fakeRes,
  formBody,
  TEST_SECRET,
} from '../helpers/harness.js';
import { deriveHandle } from '../../src/handle.js';

/**
 * SPEC §14 FR-6 test: practical-effect-size bar.
 *
 * Pass criterion: |delta_mean(hit, miss)| < 1ms over ≥1000 iterations
 * each, after ≥200-iteration warm-up. Why effect size, not p-value:
 * with enough samples a Welch's t reports significance for any constant
 * offset above ~50μs even though the offset is far below realistic
 * network jitter. The 1ms bar reflects what an attacker actually
 * observes through a connection.
 *
 * Methodology: hit and miss measurements are INTERLEAVED so that any
 * second-scale system noise (GC, CPU schedule) affects both paths
 * roughly equally.
 */

const REGISTERED = 'alice@example.com';
const UNREGISTERED = 'bob@example.com';
const N = 1000;
const WARMUP = 200;

async function timeOneLogin(handlers, email) {
  const req = fakeReq({
    method: 'POST',
    url: '/login',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ email }),
  });
  const res = fakeRes();
  const t = process.hrtime.bigint();
  await handlers.login(req, res);
  return Number(process.hrtime.bigint() - t) / 1e6;
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
const sortedPercentile = (sorted, p) =>
  sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

test(
  'FR-6: hit and miss login paths have delta_mean < 1ms',
  { timeout: 60_000 },
  async () => {
    const h = newHarness();
    h.store.upsertHandle(deriveHandle(REGISTERED, TEST_SECRET));

    // Warm up both paths so JIT, prepared-statement caches, and
    // mailer setup costs are amortised before measurement.
    for (let i = 0; i < WARMUP; i++) {
      await timeOneLogin(h.handlers, REGISTERED);
      await timeOneLogin(h.handlers, UNREGISTERED);
    }

    const hit = new Array(N);
    const miss = new Array(N);
    for (let i = 0; i < N; i++) {
      // Interleave so jitter affects both equally.
      hit[i] = await timeOneLogin(h.handlers, REGISTERED);
      miss[i] = await timeOneLogin(h.handlers, UNREGISTERED);
    }

    const meanHit = mean(hit);
    const meanMiss = mean(miss);
    const delta = Math.abs(meanHit - meanMiss);

    const sortedHit = [...hit].sort((a, b) => a - b);
    const sortedMiss = [...miss].sort((a, b) => a - b);

    console.log(
      `\nFR-6 timing measurement (N=${N}):\n` +
        `  hit  mean=${meanHit.toFixed(3)}ms  ` +
        `p50=${sortedPercentile(sortedHit, 0.5).toFixed(3)}ms  ` +
        `p99=${sortedPercentile(sortedHit, 0.99).toFixed(3)}ms\n` +
        `  miss mean=${meanMiss.toFixed(3)}ms  ` +
        `p50=${sortedPercentile(sortedMiss, 0.5).toFixed(3)}ms  ` +
        `p99=${sortedPercentile(sortedMiss, 0.99).toFixed(3)}ms\n` +
        `  Δ_mean = ${delta.toFixed(3)}ms (bar: <1.000ms)\n`,
    );

    assert.ok(
      delta < 1.0,
      `FR-6 violated: |meanHit - meanMiss| = ${delta.toFixed(3)}ms exceeds 1ms bar`,
    );
    h.close();
  },
);
