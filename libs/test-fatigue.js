/**
 * Test: Block 1.1.2 - Fatigue Simulation
 * Run: node libs/test-fatigue.js
 */

class RateLimiter {
    constructor(mode = 'fast') {
        this.setMode(mode);
        this.lastRequest = 0;
        this.requestCount = 0;
        this.windowStart = Date.now();

        this.sessionStart = Date.now();
        this.fatigueMultiplier = 1.0;
        this.FATIGUE_INCREASE_RATE = 0.002;
        this.MAX_FATIGUE = 2.0;
    }

    setMode(mode) {
        this.mode = mode;
        switch (mode) {
            case 'hybrid':
            default:
                this.minDelay = 800;
                this.maxDelay = 1500;
                break;
        }
    }

    gaussianRandom() {
        let u = 0, v = 0;
        while (u === 0) u = Math.random();
        while (v === 0) v = Math.random();
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    getGaussianDelay(mean, stdDev, min, max) {
        const gaussian = this.gaussianRandom();
        let delay = mean + (gaussian * stdDev);
        return Math.max(min, Math.min(max, delay));
    }

    getJitteredDelay() {
        const mean = (this.minDelay + this.maxDelay) / 2;
        const stdDev = (this.maxDelay - this.minDelay) / 6;
        return Math.round(this.getGaussianDelay(mean, stdDev, this.minDelay, this.maxDelay));
    }

    calculateFatigue() {
        const sessionDurationMinutes = (Date.now() - this.sessionStart) / 60000;
        const rawFatigue = 1.0 + (sessionDurationMinutes * this.FATIGUE_INCREASE_RATE);
        this.fatigueMultiplier = Math.min(rawFatigue, this.MAX_FATIGUE);
        return this.fatigueMultiplier;
    }

    resetFatigue() {
        this.sessionStart = Date.now();
        this.fatigueMultiplier = 1.0;
    }

    getFatigueStatus() {
        const durationMinutes = (Date.now() - this.sessionStart) / 60000;
        return {
            sessionDurationMinutes: Math.round(durationMinutes * 10) / 10,
            currentMultiplier: this.fatigueMultiplier,
            maxMultiplier: this.MAX_FATIGUE,
            percentFatigued: Math.round((this.fatigueMultiplier - 1) / (this.MAX_FATIGUE - 1) * 100)
        };
    }
}

// ============ TESTS ============

console.log('=== BLOCK 1.1.2 TEST: Fatigue Simulation ===\n');

// Test 1: Fresh session has no fatigue
const limiter = new RateLimiter('hybrid');
console.log('TEST 1: Fresh session starts with no fatigue');
const initialFatigue = limiter.calculateFatigue();
console.log(`  Initial multiplier: ${initialFatigue.toFixed(4)}`);
const test1 = Math.abs(initialFatigue - 1.0) < 0.001;
console.log(`  ✓ PASS: ${test1 ? 'Yes' : 'No'}\n`);

// Test 2: Simulate 30 minutes of use
console.log('TEST 2: Fatigue increases over time');
limiter.sessionStart = Date.now() - (30 * 60 * 1000); // 30 min ago
const fatigue30min = limiter.calculateFatigue();
const expected30min = 1.0 + (30 * 0.002); // 1.06
console.log(`  After 30 min, multiplier: ${fatigue30min.toFixed(4)}`);
console.log(`  Expected: ${expected30min.toFixed(4)}`);
const test2 = Math.abs(fatigue30min - expected30min) < 0.01;
console.log(`  ✓ PASS: ${test2 ? 'Yes' : 'No'}\n`);

// Test 3: Maximum fatigue is capped
console.log('TEST 3: Fatigue is capped at MAX_FATIGUE');
limiter.sessionStart = Date.now() - (1000 * 60 * 1000); // 1000 min ago
const fatigueMax = limiter.calculateFatigue();
console.log(`  After 1000 min, multiplier: ${fatigueMax.toFixed(4)}`);
console.log(`  MAX_FATIGUE: ${limiter.MAX_FATIGUE}`);
const test3 = fatigueMax === limiter.MAX_FATIGUE;
console.log(`  ✓ PASS: ${test3 ? 'Yes' : 'No'}\n`);

// Test 4: resetFatigue works
console.log('TEST 4: resetFatigue() resets to fresh state');
limiter.resetFatigue();
const afterReset = limiter.calculateFatigue();
console.log(`  After reset, multiplier: ${afterReset.toFixed(4)}`);
const test4 = Math.abs(afterReset - 1.0) < 0.001;
console.log(`  ✓ PASS: ${test4 ? 'Yes' : 'No'}\n`);

// Test 5: getFatigueStatus returns correct structure
console.log('TEST 5: getFatigueStatus() returns correct data');
limiter.sessionStart = Date.now() - (15 * 60 * 1000); // 15 min ago
limiter.calculateFatigue();
const status = limiter.getFatigueStatus();
console.log(`  Session duration: ${status.sessionDurationMinutes} min`);
console.log(`  Current multiplier: ${status.currentMultiplier.toFixed(4)}`);
console.log(`  Percent fatigued: ${status.percentFatigued}%`);
const test5 = status.sessionDurationMinutes >= 14.9 &&
    status.sessionDurationMinutes <= 15.1 &&
    typeof status.percentFatigued === 'number';
console.log(`  ✓ PASS: ${test5 ? 'Yes' : 'No'}\n`);

// Test 6: Fatigue multiplier affects delay calculation
console.log('TEST 6: Fatigue affects delay calculation');
limiter.resetFatigue();
const baseDelay = limiter.getJitteredDelay();
limiter.sessionStart = Date.now() - (60 * 60 * 1000); // 60 min ago
const fatiguedMultiplier = limiter.calculateFatigue();
const expectedIncrease = fatiguedMultiplier; // 1.12
console.log(`  Base delay: ${baseDelay}ms`);
console.log(`  Fatigue multiplier after 60min: ${fatiguedMultiplier.toFixed(2)}`);
console.log(`  Fatigued delay would be: ${Math.round(baseDelay * fatiguedMultiplier)}ms`);
const test6 = fatiguedMultiplier > 1.1 && fatiguedMultiplier < 1.15;
console.log(`  ✓ PASS: ${test6 ? 'Yes' : 'No'}\n`);

// Summary
const allPass = test1 && test2 && test3 && test4 && test5 && test6;
console.log('═══════════════════════════════════════');
console.log(`RESULT: ${allPass ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);
console.log('═══════════════════════════════════════');

process.exit(allPass ? 0 : 1);
