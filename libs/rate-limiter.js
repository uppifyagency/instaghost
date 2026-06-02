/**
 * Rate Limiter with Fast/Full/Hybrid modes
 * Implements token bucket algorithm with Gaussian-distributed delays
 * 
 * Anti-Detection Features:
 * - Gaussian distribution (Box-Muller) instead of uniform random
 * - Cryptographically secure PRNG (crypto.getRandomValues) to prevent fingerprinting
 * - Occasional micro-pauses and long pauses simulating human distraction
 * - Statistically indistinguishable from natural browsing patterns
 * 
 * @version 2.1.0 - Phase 1 Anti-Detection (Security Hardened)
 */
class RateLimiter {
    // =========================================================================
    // DEBUG CONFIGURATION
    // Set to true to see detailed anti-detection logs in DevTools Console
    // =========================================================================
    static DEBUG = false;  // Enable via sidepanel debug toggle

    constructor(mode = 'fast') {
        this.setMode(mode);
        this.lastRequest = 0;
        this.requestCount = 0;
        this.windowStart = Date.now();

        // Fatigue Simulation (Block 1.1.2)
        this.sessionStart = Date.now();
        this.fatigueMultiplier = 1.0;
        this.FATIGUE_INCREASE_RATE = 0.002;
        this.MAX_FATIGUE = 2.0;

        // Error Backoff System (Block 1.2.1)
        this.initBackoffSystem();

        // Stats tracking for logging
        this.stats = {
            totalRequests: 0,
            distractionPauses: 0,
            quickReactions: 0,
            backoffTriggers: 0
        };

        // Persist state to prevent reset on refresh
        this.storageKey = 'instaGhost_rateLimiter';
        this.loadState();

        this._log('🚀 RateLimiter initialized', { mode, minDelay: this.minDelay, maxDelay: this.maxDelay });
    }

    /**
     * Load persisted state from storage
     */
    async loadState() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            try {
                const result = await chrome.storage.local.get(this.storageKey);
                const data = result[this.storageKey];
                if (data) {
                    // Restore fatigue state
                    if (data.sessionStart) this.sessionStart = data.sessionStart;
                    if (data.fatigueMultiplier) this.fatigueMultiplier = data.fatigueMultiplier;

                    // Restore backoff state if active
                    if (data.backoff) {
                        this.backoffState = { ...this.backoffState, ...data.backoff };
                    }

                    this._log('💾 State restored', data);
                }
            } catch (e) {
                console.error('[RateLimiter] Failed to load state', e);
            }
        }
    }

    /**
     * Save current state to storage
     */
    saveState() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            const state = {
                sessionStart: this.sessionStart,
                fatigueMultiplier: this.fatigueMultiplier,
                backoff: this.backoffState,
                lastSaved: Date.now()
            };
            chrome.storage.local.set({ [this.storageKey]: state });
        }
    }

    /**
     * Debug logger - only outputs when DEBUG is enabled
     * @param {string} message
     * @param {Object} data
     */
    _log(message, data = null) {
        if (!RateLimiter.DEBUG) return;
        const prefix = '%c[RateLimiter]';
        const style = 'color: #8B5CF6; font-weight: bold;';
        if (data) {
            console.log(prefix, style, message, data);
        } else {
            console.log(prefix, style, message);
        }
    }

    /**
     * Warning logger - always outputs (important events)
     */
    _warn(message, data = null) {
        const prefix = '%c[RateLimiter]';
        const style = 'color: #F59E0B; font-weight: bold;';
        if (data) {
            console.warn(prefix, style, message, data);
        } else {
            console.warn(prefix, style, message);
        }
    }

    /**
     * Set rate limiting mode
     * @param {'fast'|'full'|'hybrid'} mode
     */
    setMode(mode) {
        this.mode = mode;
        switch (mode) {
            case 'fast':
                // Grid-only extraction - no captions, maximum speed
                this.minDelay = 300;   // 0.3 seconds minimum
                this.maxDelay = 600;   // 0.6 seconds maximum
                this.requestsPerMinute = 60;
                this.scrollDelay = 400;
                this.extractionMethod = 'grid';
                break;
            case 'full':
                // Modal-click extraction - complete data, slower
                this.minDelay = 2000;  // 2 seconds minimum
                this.maxDelay = 3500;  // 3.5 seconds maximum
                this.requestsPerMinute = 15;
                this.scrollDelay = 1200;
                this.extractionMethod = 'modal';
                break;
            case 'hybrid':
            default:
                // Background tab extraction - balanced speed/data
                this.minDelay = 800;   // 0.8 seconds minimum
                this.maxDelay = 1500;  // 1.5 seconds maximum
                this.requestsPerMinute = 30;
                this.scrollDelay = 600;
                this.extractionMethod = 'background';
                break;
        }
    }

    // =========================================================================
    // GAUSSIAN DISTRIBUTION METHODS (Anti-Detection Phase 1)
    // =========================================================================

    /**
     * Generate random number from standard normal distribution (mean=0, std=1)
     * Uses Box-Muller transform to convert uniform distribution to Gaussian
     * 
     * Why Gaussian? Humans don't have uniform timing - their reaction times
     * follow a bell curve centered around a natural pace. Uniform random
     * (Math.random) is statistically detectable by anti-bot systems.
     * 
     * @returns {number} Random value from standard normal distribution
     */
    /**
     * Generate a cryptographically secure random number between 0 (inclusive) and 1 (exclusive)
     * Replaces Math.random() to prevent PRNG fingerprinting (RISK-001)
     * 
     * @returns {number} Random value in [0, 1)
     */
    static secureRandom() {
        if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
            const array = new Uint32Array(1);
            crypto.getRandomValues(array);
            return array[0] / (0xffffffff + 1);
        }
        return Math.random(); // Fallback should practically never happen in Chrome Extension environment
    }

    /**
     * Instance wrapper for static secureRandom (for backward compatibility if needed)
     */
    secureRandom() {
        return RateLimiter.secureRandom();
    }

    /**
     * Generate random number from standard normal distribution (mean=0, std=1)
     * Uses Box-Muller transform to convert uniform distribution to Gaussian
     * 
     * Why Gaussian? Humans don't have uniform timing - their reaction times
     * follow a bell curve centered around a natural pace. Uniform random
     * (Math.random) is statistically detectable by anti-bot systems.
     * 
     * @returns {number} Random value from standard normal distribution
     */
    gaussianRandom() {
        let u = 0, v = 0;
        // Avoid log(0) which would produce -Infinity
        while (u === 0) u = this.secureRandom();
        while (v === 0) v = this.secureRandom();
        // Box-Muller transform
        return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
    }

    /**
     * Generate delay from Gaussian distribution with specified parameters
     * Result is clamped to prevent extreme outliers that could cause issues
     * 
     * @param {number} mean - Center of the distribution (typical delay)
     * @param {number} stdDev - Spread of values (variation in timing)
     * @param {number} min - Minimum acceptable delay (hard floor)
     * @param {number} max - Maximum acceptable delay (hard ceiling)
     * @returns {number} Delay in milliseconds from Gaussian distribution
     */
    getGaussianDelay(mean, stdDev, min, max) {
        const gaussian = this.gaussianRandom();
        // Scale from standard normal to desired distribution
        let delay = mean + (gaussian * stdDev);
        // Clamp to prevent extreme values (important for UX and detection)
        return Math.max(min, Math.min(max, delay));
    }

    /**
     * Get delay with human-like Gaussian jitter
     * 
     * Distribution characteristics:
     * - Mean: midpoint between min and max delays
     * - StdDev: range/6 (ensures ~99.7% of values within min-max via 3-sigma rule)
     * - 10% chance of "distraction pause" (2x delay) - simulates human attention drift
     * - 5% chance of "quick action" (0.5x delay) - simulates eager/impatient moments
     * 
     * @returns {number} Delay in milliseconds
     */
    getJitteredDelay() {
        // Calculate Gaussian parameters from mode's min/max
        const mean = (this.minDelay + this.maxDelay) / 2;
        // StdDev = range/6 ensures 99.7% of samples fall within [min, max]
        const stdDev = (this.maxDelay - this.minDelay) / 6;

        let delay = this.getGaussianDelay(mean, stdDev, this.minDelay, this.maxDelay);
        let behaviorType = 'normal';

        // Simulate human behavioral patterns
        const behaviorRoll = this.secureRandom();

        if (behaviorRoll < 0.10) {
            // 10% chance: distraction pause (looking at something else)
            delay *= 2;
            behaviorType = '🧠 DISTRACTION PAUSE';
            this.stats.distractionPauses++;
        } else if (behaviorRoll < 0.15) {
            // 5% chance: quick reaction (eager/impatient user)
            delay *= 0.5;
            delay = Math.max(delay, this.minDelay * 0.5);
            behaviorType = '⚡ QUICK REACTION';
            this.stats.quickReactions++;
        }

        const finalDelay = Math.round(delay);

        // Log Gaussian distribution details
        this._log('📊 Gaussian Delay Calculation', {
            mode: this.mode,
            mean: `${mean}ms`,
            stdDev: `${stdDev.toFixed(1)}ms`,
            rawDelay: `${delay.toFixed(0)}ms`,
            behavior: behaviorType,
            finalDelay: `${finalDelay}ms`
        });

        return finalDelay;
    }

    // =========================================================================
    // FATIGUE SIMULATION METHODS (Anti-Detection Phase 1 - Block 1.1.2)
    // =========================================================================

    /**
     * Calculate fatigue multiplier based on session duration
     * 
     * Human cognitive fatigue follows a predictable pattern:
     * - Fresh start: 100% speed (multiplier = 1.0)
     * - After 10 min: ~102% of original delay (multiplier = 1.02)
     * - After 30 min: ~106% of original delay (multiplier = 1.06)
     * - After 60 min: ~112% of original delay (multiplier = 1.12)
     * - Maximum: 200% of original delay (multiplier = 2.0)
     * 
     * This gradual slowdown mimics natural human behavior where
     * browsing speed decreases over extended sessions.
     * 
     * @returns {number} Fatigue multiplier (1.0 = fresh, up to MAX_FATIGUE)
     */
    calculateFatigue() {
        const sessionDurationMinutes = (Date.now() - this.sessionStart) / 60000;

        // Linear increase: 1.0 + (minutes * rate)
        const rawFatigue = 1.0 + (sessionDurationMinutes * this.FATIGUE_INCREASE_RATE);
        const previousFatigue = this.fatigueMultiplier;

        // Clamp to maximum to prevent extreme slowdowns
        this.fatigueMultiplier = Math.min(rawFatigue, this.MAX_FATIGUE);

        // Log fatigue changes (only when significant change)
        if (Math.abs(this.fatigueMultiplier - previousFatigue) > 0.01) {
            this._log('😴 Fatigue Updated', {
                sessionDuration: `${sessionDurationMinutes.toFixed(1)} min`,
                multiplier: `${this.fatigueMultiplier.toFixed(3)}x`,
                slowdownPercent: `+${((this.fatigueMultiplier - 1) * 100).toFixed(1)}%`,
                maxFatigue: `${this.MAX_FATIGUE}x`
            });
            this.saveState();
        }

        return this.fatigueMultiplier;
    }

    /**
     * Reset fatigue to fresh state
     * 
     * Call this when:
     * - User explicitly starts a new monitoring session
     * - After a significant break (detected or manual)
     * - Extension is re-activated after being idle
     * 
     * This prevents accumulated fatigue from previous sessions
     * affecting new browsing behavior.
     */
    resetFatigue() {
        this.sessionStart = Date.now();
        this.fatigueMultiplier = 1.0;
        this.saveState();
        console.log('[RateLimiter] Fatigue reset - starting fresh session');
    }

    /**
     * Get current fatigue level for debugging/UI
     * @returns {Object} Fatigue state information
     */
    getFatigueStatus() {
        const durationMinutes = (Date.now() - this.sessionStart) / 60000;
        return {
            sessionDurationMinutes: Math.round(durationMinutes * 10) / 10,
            currentMultiplier: this.fatigueMultiplier,
            maxMultiplier: this.MAX_FATIGUE,
            percentFatigued: Math.round((this.fatigueMultiplier - 1) / (this.MAX_FATIGUE - 1) * 100)
        };
    }

    // =========================================================================
    // ERROR BACKOFF SYSTEM (Anti-Detection Phase 1 - Block 1.2.1)
    // =========================================================================

    /**
     * Initialize the error backoff tracking system
     * 
     * This system prevents escalating bans by backing off when Instagram
     * signals rate limiting (429) or server issues (503). Without this,
     * continuing to make requests during rate limiting makes things worse.
     */
    initBackoffSystem() {
        this.backoffState = {
            consecutiveErrors: 0,
            lastErrorTime: 0,
            currentBackoff: 0,
            baseBackoff: 60000,      // 1 minute base wait
            maxBackoff: 1800000,     // 30 minutes maximum wait
            multiplier: 2,           // Double wait time each error
            inSafeMode: false
        };
    }

    /**
     * Record an error and calculate exponential backoff
     * 
     * Backoff formula: base * 2^(consecutiveErrors - 1)
     * - 1st error: 1 min
     * - 2nd error: 2 min
     * - 3rd error: 4 min
     * - 4th error: 8 min
     * - 5th error: 16 min + SAFE MODE
     * 
     * @param {number} statusCode - HTTP status code (429, 503, etc)
     */
    recordError(statusCode) {
        const state = this.backoffState;
        state.consecutiveErrors++;
        state.lastErrorTime = Date.now();

        // Exponential backoff: base * 2^(n-1)
        state.currentBackoff = Math.min(
            state.baseBackoff * Math.pow(state.multiplier, state.consecutiveErrors - 1),
            state.maxBackoff
        );

        console.warn(`[RateLimiter] Error ${statusCode} (#${state.consecutiveErrors}). Backoff: ${Math.round(state.currentBackoff / 1000)}s`);

        // After 5 consecutive errors, enter safe mode
        if (state.consecutiveErrors >= 5 && !state.inSafeMode) {
            this.enterSafeMode();
        }
    }

    /**
     * Record a successful request - gradually reduce backoff
     * 
     * We don't immediately reset to zero because Instagram may still be
     * watching. Gradual recovery is safer than instant recovery.
     */
    recordSuccess() {
        const state = this.backoffState;
        if (state.consecutiveErrors > 0) {
            // Gradual reset: -0.5 per success (need 2 successes to clear 1 error)
            state.consecutiveErrors = Math.max(0, state.consecutiveErrors - 0.5);

            if (state.consecutiveErrors < 1) {
                state.currentBackoff = 0;
                console.log('[RateLimiter] Backoff cleared - back to normal operation');
            }
        }
    }

    /**
     * Enter ultra-safe mode after too many errors
     * 
     * This drastically reduces speed to prevent account flagging.
     * Once in safe mode, we stay there until explicitly reset.
     */
    enterSafeMode() {
        const state = this.backoffState;
        state.inSafeMode = true;

        // Triple all delays
        this.minDelay *= 3;
        this.maxDelay *= 3;
        this.scrollDelay *= 3;

        // Reduce requests per minute to 1/3
        this.requestsPerMinute = Math.max(5, Math.floor(this.requestsPerMinute / 3));

        console.warn('[RateLimiter] ⚠️ SAFE MODE ACTIVATED - Drastically reducing speed');
        console.warn(`[RateLimiter] New limits: ${this.requestsPerMinute} req/min, ${this.minDelay}-${this.maxDelay}ms delays`);
    }

    /**
     * Exit safe mode and restore normal operation
     * Call this when user explicitly requests it or after extended cool-down
     */
    exitSafeMode() {
        if (!this.backoffState.inSafeMode) return;

        // Restore original mode settings
        this.setMode(this.mode);
        this.backoffState.inSafeMode = false;
        this.backoffState.consecutiveErrors = 0;
        this.backoffState.currentBackoff = 0;

        console.log('[RateLimiter] Safe mode deactivated - normal operation restored');
    }

    /**
     * Get remaining backoff time in milliseconds
     * @returns {number} Milliseconds to wait, 0 if no backoff active
     */
    getBackoffRemaining() {
        const state = this.backoffState;
        if (state.currentBackoff === 0) return 0;

        const elapsed = Date.now() - state.lastErrorTime;
        return Math.max(0, state.currentBackoff - elapsed);
    }

    /**
     * Check if we're currently in backoff period
     * @returns {boolean}
     */
    isInBackoff() {
        return this.getBackoffRemaining() > 0;
    }

    /**
     * Get backoff status for UI/debugging
     * @returns {Object}
     */
    getBackoffStatus() {
        const state = this.backoffState;
        const remaining = this.getBackoffRemaining();
        return {
            consecutiveErrors: Math.floor(state.consecutiveErrors),
            currentBackoffMs: state.currentBackoff,
            remainingMs: remaining,
            remainingSeconds: Math.ceil(remaining / 1000),
            inSafeMode: state.inSafeMode,
            isActive: remaining > 0
        };
    }

    /**
     * Wait for next available slot
     * @returns {Promise<void>}
     */
    async waitForSlot() {
        this.stats.totalRequests++;
        const requestNumber = this.stats.totalRequests;

        this._log(`\n====== REQUEST #${requestNumber} ======`);

        // === BLOCK 1.2.1: Check backoff FIRST ===
        const backoffRemaining = this.getBackoffRemaining();
        if (backoffRemaining > 0) {
            this._warn('🛑 BACKOFF ACTIVE', {
                remainingSeconds: Math.ceil(backoffRemaining / 1000),
                reason: 'Previous error triggered exponential backoff'
            });
            await this.sleep(backoffRemaining);
        }

        const now = Date.now();

        // Reset window if minute has passed
        if (now - this.windowStart > 60000) {
            this._log('🔄 Rate limit window reset (1 minute passed)');
            this.windowStart = now;
            this.requestCount = 0;
        }

        // Check if we've exceeded rate limit
        if (this.requestCount >= this.requestsPerMinute) {
            const waitTime = 60000 - (now - this.windowStart);
            if (waitTime > 0) {
                this._warn('⏳ Rate limit reached', {
                    requestsThisMinute: this.requestCount,
                    maxAllowed: this.requestsPerMinute,
                    waitingSeconds: Math.ceil(waitTime / 1000)
                });
                await this.sleep(waitTime);
                this.windowStart = Date.now();
                this.requestCount = 0;
            }
        }

        // Ensure minimum delay between requests
        const elapsed = now - this.lastRequest;
        const baseDelay = this.getJitteredDelay();

        // Apply fatigue multiplier (Block 1.1.2)
        const fatigueMultiplier = this.calculateFatigue();
        const delay = Math.round(baseDelay * fatigueMultiplier);

        // Calculate actual wait needed
        const actualWait = Math.max(0, delay - elapsed);

        // Comprehensive log of all delay factors
        this._log('⏱️ Delay Breakdown', {
            '1️⃣ Base Gaussian': `${baseDelay}ms`,
            '2️⃣ Fatigue ×': fatigueMultiplier.toFixed(3),
            '3️⃣ Final Delay': `${delay}ms`,
            '4️⃣ Elapsed Since Last': `${elapsed}ms`,
            '5️⃣ Actual Wait': `${actualWait}ms`,
            '📊 Mode': this.mode,
            '📈 Requests/min': `${this.requestCount}/${this.requestsPerMinute}`
        });

        if (actualWait > 0) {
            await this.sleep(actualWait);
        }

        this.lastRequest = Date.now();
        this.requestCount++;

        this._log(`✅ Request #${requestNumber} proceeding\n`);
    }

    /**
     * Get scroll delay with jitter
     * @returns {number}
     */
    getScrollDelay() {
        return this.scrollDelay + this.secureRandom() * 500;
    }

    /**
     * Sleep utility
     * @param {number} ms
     * @returns {Promise<void>}
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get current mode
     * @returns {string}
     */
    getMode() {
        return this.mode;
    }

    /**
     * Get status for UI
     * @returns {Object}
     */
    getStatus() {
        return {
            mode: this.mode,
            requestsThisMinute: this.requestCount,
            maxRequestsPerMinute: this.requestsPerMinute,
            lastRequest: this.lastRequest,
            // Fatigue info (Block 1.1.2)
            fatigue: this.getFatigueStatus(),
            // Backoff info (Block 1.2.1)
            backoff: this.getBackoffStatus()
        };
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.RateLimiter = RateLimiter;
}
