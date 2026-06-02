/**
 * Test: Block 1.2.1 - Error Backoff System
 * Run: node libs/test-backoff.js
 */

class RateLimiter {
    constructor(mode = 'fast') {
        this.setMode(mode);
        this.initBackoffSystem();
    }

    setMode(mode) {
        this.mode = mode;
        this.minDelay = 800;
        this.maxDelay = 1500;
        this.requestsPerMinute = 30;
        this.scrollDelay = 600;
    }

    initBackoffSystem() {
        this.backoffState = {
            consecutiveErrors: 0,
            lastErrorTime: 0,
            currentBackoff: 0,
            baseBackoff: 60000,
            maxBackoff: 1800000,
            multiplier: 2,
            inSafeMode: false
        };
    }

    recordError(statusCode) {
        const state = this.backoffState;
        state.consecutiveErrors++;
        state.lastErrorTime = Date.now();
        state.currentBackoff = Math.min(
            state.baseBackoff * Math.pow(state.multiplier, state.consecutiveErrors - 1),
            state.maxBackoff
        );
        if (state.consecutiveErrors >= 5 && !state.inSafeMode) {
            this.enterSafeMode();
        }
    }

    recordSuccess() {
        const state = this.backoffState;
        if (state.consecutiveErrors > 0) {
            state.consecutiveErrors = Math.max(0, state.consecutiveErrors - 0.5);
            if (state.consecutiveErrors < 1) {
                state.currentBackoff = 0;
            }
        }
    }

    enterSafeMode() {
        this.backoffState.inSafeMode = true;
        this.minDelay *= 3;
        this.maxDelay *= 3;
        this.requestsPerMinute = Math.max(5, Math.floor(this.requestsPerMinute / 3));
    }

    exitSafeMode() {
        if (!this.backoffState.inSafeMode) return;
        this.setMode(this.mode);
        this.backoffState.inSafeMode = false;
        this.backoffState.consecutiveErrors = 0;
        this.backoffState.currentBackoff = 0;
    }

    getBackoffRemaining() {
        const state = this.backoffState;
        if (state.currentBackoff === 0) return 0;
        const elapsed = Date.now() - state.lastErrorTime;
        return Math.max(0, state.currentBackoff - elapsed);
    }

    isInBackoff() {
        return this.getBackoffRemaining() > 0;
    }

    getBackoffStatus() {
        const state = this.backoffState;
        const remaining = this.getBackoffRemaining();
        return {
            consecutiveErrors: Math.floor(state.consecutiveErrors),
            currentBackoffMs: state.currentBackoff,
            remainingMs: remaining,
            inSafeMode: state.inSafeMode,
            isActive: remaining > 0
        };
    }
}

// ============ TESTS ============

console.log('=== BLOCK 1.2.1 TEST: Error Backoff System ===\n');

// Test 1: Initial state has no backoff
const limiter = new RateLimiter('hybrid');
console.log('TEST 1: Initial state has no backoff');
const initialStatus = limiter.getBackoffStatus();
console.log(`  Consecutive errors: ${initialStatus.consecutiveErrors}`);
console.log(`  Current backoff: ${initialStatus.currentBackoffMs}ms`);
console.log(`  In safe mode: ${initialStatus.inSafeMode}`);
const test1 = initialStatus.consecutiveErrors === 0 &&
    initialStatus.currentBackoffMs === 0 &&
    !initialStatus.inSafeMode;
console.log(`  ✓ PASS: ${test1 ? 'Yes' : 'No'}\n`);

// Test 2: Exponential backoff calculation
console.log('TEST 2: Exponential backoff increases correctly');
limiter.recordError(429);
const after1 = limiter.backoffState.currentBackoff;
limiter.recordError(429);
const after2 = limiter.backoffState.currentBackoff;
limiter.recordError(429);
const after3 = limiter.backoffState.currentBackoff;
console.log(`  After 1st error: ${after1 / 1000}s (expected: 60s)`);
console.log(`  After 2nd error: ${after2 / 1000}s (expected: 120s)`);
console.log(`  After 3rd error: ${after3 / 1000}s (expected: 240s)`);
const test2 = after1 === 60000 && after2 === 120000 && after3 === 240000;
console.log(`  ✓ PASS: ${test2 ? 'Yes' : 'No'}\n`);

// Test 3: Safe mode triggers after 5 errors
console.log('TEST 3: Safe mode triggers after 5 consecutive errors');
limiter.initBackoffSystem(); // Reset
limiter.setMode('hybrid');
const originalReqPerMin = limiter.requestsPerMinute;
for (let i = 0; i < 5; i++) {
    limiter.recordError(429);
}
console.log(`  In safe mode: ${limiter.backoffState.inSafeMode}`);
console.log(`  Original req/min: ${originalReqPerMin}`);
console.log(`  New req/min: ${limiter.requestsPerMinute}`);
const test3 = limiter.backoffState.inSafeMode &&
    limiter.requestsPerMinute < originalReqPerMin;
console.log(`  ✓ PASS: ${test3 ? 'Yes' : 'No'}\n`);

// Test 4: Gradual recovery on success
console.log('TEST 4: Gradual recovery on success');
limiter.initBackoffSystem();
limiter.recordError(429);
limiter.recordError(429);
const beforeRecovery = limiter.backoffState.consecutiveErrors;
limiter.recordSuccess();
const afterOneSuccess = limiter.backoffState.consecutiveErrors;
limiter.recordSuccess();
limiter.recordSuccess();
limiter.recordSuccess();
const afterFourSuccesses = limiter.backoffState.consecutiveErrors;
console.log(`  Before recovery: ${beforeRecovery} errors`);
console.log(`  After 1 success: ${afterOneSuccess} errors`);
console.log(`  After 4 successes: ${afterFourSuccesses} errors`);
const test4 = beforeRecovery === 2 &&
    afterOneSuccess === 1.5 &&
    afterFourSuccesses === 0;
console.log(`  ✓ PASS: ${test4 ? 'Yes' : 'No'}\n`);

// Test 5: exitSafeMode restores settings
console.log('TEST 5: exitSafeMode restores normal operation');
limiter.initBackoffSystem();
limiter.setMode('hybrid');
for (let i = 0; i < 5; i++) limiter.recordError(429);
const inSafeModeBefore = limiter.backoffState.inSafeMode;
limiter.exitSafeMode();
const inSafeModeAfter = limiter.backoffState.inSafeMode;
const restoredReqPerMin = limiter.requestsPerMinute;
console.log(`  Safe mode before exit: ${inSafeModeBefore}`);
console.log(`  Safe mode after exit: ${inSafeModeAfter}`);
console.log(`  Restored req/min: ${restoredReqPerMin}`);
const test5 = inSafeModeBefore && !inSafeModeAfter && restoredReqPerMin === 30;
console.log(`  ✓ PASS: ${test5 ? 'Yes' : 'No'}\n`);

// Test 6: Max backoff is capped
console.log('TEST 6: Backoff is capped at maxBackoff (30 min)');
limiter.initBackoffSystem();
for (let i = 0; i < 20; i++) limiter.recordError(429);
const maxCap = limiter.backoffState.currentBackoff;
console.log(`  After 20 errors, backoff: ${maxCap / 60000} min`);
console.log(`  Max allowed: 30 min`);
const test6 = maxCap === 1800000;
console.log(`  ✓ PASS: ${test6 ? 'Yes' : 'No'}\n`);

// Summary
const allPass = test1 && test2 && test3 && test4 && test5 && test6;
console.log('═══════════════════════════════════════');
console.log(`RESULT: ${allPass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
console.log('═══════════════════════════════════════');

process.exit(allPass ? 0 : 1);
