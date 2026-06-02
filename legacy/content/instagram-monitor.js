/**
 * Instagram Monitor - Main Content Script
 * Monitors Instagram for new posts using MutationObserver and IntersectionObserver
 */
class InstagramMonitor {
    constructor() {
        this.isMonitoring = false;
        this.processedPosts = new Set();
        this.processingPosts = new Set(); // Guard against race conditions
        this.lruCache = new LRUCache(10000);
        this.observer = null;
        this.intersectionObserver = null;
        this.navigationObserver = null; // Store reference to prevent memory leak
        this.sessionStats = {
            startTime: null,
            postsFound: 0,
            reelsFound: 0,
            carouselsFound: 0
        };

        this.init();
    }

    /**
     * Initialize the monitor
     */
    init() {
        console.log('📸 Instagram Monitor initializing...');

        // Listen for messages from background/popup
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            this.handleMessage(message, sendResponse);
            return true; // Keep channel open for async response
        });

        // Auto-start if previously active
        chrome.storage.local.get(['monitoringActive'], (result) => {
            if (result.monitoringActive) {
                setTimeout(() => this.startMonitoring(), 1000);
            }
        });

        // ARCH-003: Load persisted seen URLs for deduplication across sessions
        this.loadSeenUrls();

        // Listen for URL changes (SPA navigation)
        this.setupNavigationListener();

        // HIGH-001 FIX: Cleanup observers on page unload to prevent memory leaks
        window.addEventListener('beforeunload', () => {
            this.cleanup();
        });
    }

    /**
     * HIGH-001 FIX: Cleanup all observers
     */
    cleanup() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = null;
        }
        if (this.navigationObserver) {
            this.navigationObserver.disconnect();
            this.navigationObserver = null;
        }
        this.saveSeenUrls();
    }

    /**
     * ARCH-003: Load seen URLs from chrome.storage
     */
    async loadSeenUrls() {
        try {
            const result = await chrome.storage.local.get(['seenPostUrls']);
            if (result.seenPostUrls && Array.isArray(result.seenPostUrls)) {
                result.seenPostUrls.forEach(url => this.processedPosts.add(url));
                console.log(`📋 Loaded ${result.seenPostUrls.length} seen URLs from storage`);
            }
        } catch (e) {
            console.warn('Failed to load seen URLs:', e);
        }
    }

    /**
     * ARCH-003: Save seen URLs to chrome.storage (last 1000 to limit size)
     */
    saveSeenUrls() {
        const urls = Array.from(this.processedPosts).slice(-1000);
        chrome.storage.local.set({ seenPostUrls: urls });
    }

    /**
     * Handle incoming messages
     * @param {Object} message 
     * @param {Function} sendResponse 
     */
    handleMessage(message, sendResponse) {
        switch (message.action) {
            case 'start_monitoring':
                this.startMonitoring();
                sendResponse({ success: true, status: 'started' });
                break;

            case 'stop_monitoring':
                this.stopMonitoring();
                sendResponse({ success: true, status: 'stopped' });
                break;

            case 'get_status':
                sendResponse({
                    isMonitoring: this.isMonitoring,
                    stats: this.sessionStats,
                    cacheSize: this.lruCache.size
                });
                break;

            case 'export_data':
                this.requestExport();
                sendResponse({ success: true });
                break;

            case 'start_profile_scrape':
                this.startProfileScrape(message.options, sendResponse);
                break;

            case 'stop_profile_scrape':
                this.stopProfileScrape(sendResponse);
                break;

            case 'get_scrape_status':
                sendResponse({
                    isRunning: this.profileScraper?.isRunning || false,
                    current: this.profileScraper?.extractedPosts?.length || 0,
                    total: this.profileScraper?.postLimit || 0,
                    mode: this.profileScraper?.rateLimiter?.getMode() || 'hybrid'
                });
                break;

            default:
                sendResponse({ success: false, error: 'Unknown action' });
        }
    }

    /**
     * Start profile scraping
     * @param {Object} options - Scrape options
     * @param {Function} sendResponse
     */
    startProfileScrape(options, sendResponse) {
        if (typeof ProfileScraper === 'undefined') {
            sendResponse({ success: false, error: 'ProfileScraper not available' });
            return;
        }

        const startTime = Date.now();

        this.profileScraper = new ProfileScraper({
            postLimit: options?.postLimit || 100,
            mode: options?.mode || 'safe',
            onProgress: (data) => {
                // Send progress to sidepanel
                chrome.runtime.sendMessage({
                    action: 'scrape_progress',
                    data: { ...data, startTime }
                });
            },
            onComplete: (result) => {
                // Send extracted posts to background for saving
                if (result.posts?.length > 0) {
                    result.posts.forEach(post => {
                        chrome.runtime.sendMessage({
                            action: 'post_found',
                            payload: post  // Must use 'payload' to match service-worker handler
                        });
                    });
                }
                chrome.runtime.sendMessage({
                    action: 'scrape_complete',
                    data: result
                });
            },
            onError: (error) => {
                chrome.runtime.sendMessage({
                    action: 'scrape_error',
                    error: error
                });
            }
        });

        this.profileScraper.startScraping();
        sendResponse({ success: true });
    }

    /**
     * Stop profile scraping
     * @param {Function} sendResponse
     */
    stopProfileScrape(sendResponse) {
        if (this.profileScraper) {
            this.profileScraper.stopScraping();
        }
        sendResponse({ success: true });
    }

    /**
     * Start monitoring Instagram posts
     */
    startMonitoring() {
        if (this.isMonitoring) {
            console.log('⚠️ Monitor already active');
            return;
        }

        this.isMonitoring = true;
        this.sessionStats.startTime = Date.now();

        chrome.storage.local.set({ monitoringActive: true });

        console.log('🟢 Instagram Monitor ATTIVO');
        this.showNotification('Monitor attivato', 'success');

        // Setup observers
        this.setupMutationObserver();
        this.setupIntersectionObserver();

        // Scan existing posts
        this.scanExistingPosts();

        // Notify background
        chrome.runtime.sendMessage({
            action: 'monitoring_started',
            timestamp: Date.now()
        }).catch(() => { }); // Ignore if popup closed
    }

    /**
     * Stop monitoring
     */
    stopMonitoring() {
        if (!this.isMonitoring) return;

        this.isMonitoring = false;
        chrome.storage.local.set({ monitoringActive: false });

        // Disconnect observers
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = null;
        }
        if (this.navigationObserver) {
            this.navigationObserver.disconnect();
            this.navigationObserver = null;
        }

        // Clear processing guard
        this.processingPosts.clear();

        console.log('🔴 Instagram Monitor DISATTIVATO');
        console.log(`📊 Sessione: ${this.sessionStats.postsFound} post trovati`);
        this.showNotification('Monitor disattivato', 'warning');

        // Notify background
        chrome.runtime.sendMessage({
            action: 'monitoring_stopped',
            timestamp: Date.now(),
            stats: this.sessionStats
        }).catch(() => { });
    }

    /**
     * Setup MutationObserver for dynamically loaded content
     * NO DEBOUNCING - processes immediately for fastest capture
     */
    setupMutationObserver() {
        this.observer = new MutationObserver((mutations) => {
            if (!this.isMonitoring) return;

            for (const mutation of mutations) {
                if (mutation.addedNodes.length) {
                    mutation.addedNodes.forEach((node) => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            this.checkForNewPosts(node);
                        }
                    });
                }
            }
        });

        // Observe the entire body for changes
        this.observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        console.log('👁️ MutationObserver attivo');
    }

    /**
     * Setup IntersectionObserver for viewport detection
     */
    setupIntersectionObserver() {
        // Randomize margins for anti-detection
        const randomMargin = Math.floor(Math.random() * 200) + 100; // 100-300px
        const randomThreshold = 0.1 + Math.random() * 0.15; // 10-25%

        this.intersectionObserver = new IntersectionObserver(
            (entries) => this.handleIntersection(entries),
            {
                rootMargin: `${randomMargin}px`,
                threshold: randomThreshold,
                root: null
            }
        );

        console.log('👁️ IntersectionObserver attivo');
    }

    /**
     * Check element for new Instagram posts
     * @param {Element} element 
     */
    checkForNewPosts(element) {
        const postSelectors = [
            'article[role="presentation"]',
            'article',
            'div[role="presentation"] > div > div',
            'a[href*="/p/"]',
            'a[href*="/reel/"]'
        ];

        for (const selector of postSelectors) {
            try {
                const elements = element.matches?.(selector)
                    ? [element]
                    : element.querySelectorAll(selector);

                elements.forEach(el => {
                    const container = this.findPostContainer(el);
                    if (container && !this.isAlreadyObserved(container)) {
                        this.markAsObserved(container);
                        this.intersectionObserver.observe(container);
                    }
                });
            } catch (e) {
                // Selector may not be valid for this element
            }
        }
    }

    /**
     * Find the main post container element
     * @param {Element} element 
     * @returns {Element|null}
     */
    findPostContainer(element) {
        // Try to find article parent (main post container)
        let container = element.closest('article');

        if (!container) {
            container = element.closest('div[role="presentation"]');
        }

        if (!container) {
            container = element.closest('div[style*="position"]');
        }

        return container || element;
    }

    /**
     * Check if element is already being observed
     * @param {Element} element 
     * @returns {boolean}
     */
    isAlreadyObserved(element) {
        return element.hasAttribute('data-insta-monitor');
    }

    /**
     * Mark element as being observed
     * @param {Element} element 
     */
    markAsObserved(element) {
        element.setAttribute('data-insta-monitor', 'true');
    }

    /**
     * Handle intersection events with race condition protection
     * @param {IntersectionObserverEntry[]} entries 
     */
    async handleIntersection(entries) {
        for (const entry of entries) {
            if (entry.isIntersecting && this.isMonitoring) {
                const postElement = entry.target;

                // Get unique identifier for this element
                const elementId = postElement.getAttribute('data-insta-monitor-id') ||
                    `elem-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;

                if (!postElement.hasAttribute('data-insta-monitor-id')) {
                    postElement.setAttribute('data-insta-monitor-id', elementId);
                }

                // Race condition guard - skip if already being processed
                if (this.processingPosts.has(elementId)) {
                    continue;
                }

                // Mark as processing before async operations
                this.processingPosts.add(elementId);

                // Stop observing this element immediately
                this.intersectionObserver.unobserve(postElement);

                try {
                    // Add random delay for human-like behavior
                    await this.randomDelay(100, 500);

                    // Extract and save data (only if still monitoring)
                    if (this.isMonitoring) {
                        await this.processPost(postElement);
                    }
                } finally {
                    // Always remove from processing set
                    this.processingPosts.delete(elementId);
                }
            }
        }
    }

    /**
     * Process a post element
     * @param {Element} postElement 
     */
    async processPost(postElement) {
        try {
            const extractor = new InstagramExtractor(postElement);
            const data = await extractor.extract();

            // Validate post data
            if (!data.postUrl) {
                console.debug('⏩ Post senza URL, saltato');
                return;
            }

            // Check cache for duplicates
            const cacheKey = data.postUrl;
            if (this.lruCache.has(cacheKey)) {
                console.debug('⏩ Post già processato:', cacheKey);
                return;
            }

            // Add to cache
            this.lruCache.set(cacheKey, true);
            this.processedPosts.add(cacheKey);

            // ARCH-003: Persist seen URLs periodically (every 10 posts)
            if (this.processedPosts.size % 10 === 0) {
                this.saveSeenUrls();
            }

            // Update stats
            this.updateStats(data.postType);

            // Enrich data with normalized timestamps
            const enrichedData = {
                ...data,
                capturedAt: Date.now(),  // Unix timestamp (ms)
                capturedAtISO: new Date().toISOString(),  // ISO string for readability
                pageUrl: window.location.href,
                scrollPosition: window.scrollY,
                viewportInfo: {
                    width: window.innerWidth,
                    height: window.innerHeight
                }
            };

            console.log(`📷 Post trovato: ${data.postType}`, data.postUrl);

            // Send to background for persistence
            this.savePost(enrichedData);

            // Visual feedback
            this.highlightPost(postElement);

        } catch (error) {
            console.error('❌ Errore estrazione post:', error);
        }
    }

    /**
     * Update session statistics
     * @param {string} postType 
     */
    updateStats(postType) {
        this.sessionStats.postsFound++;

        switch (postType) {
            case 'reel':
                this.sessionStats.reelsFound++;
                break;
            case 'carousel':
                this.sessionStats.carouselsFound++;
                break;
        }
    }

    /**
     * Save post to background storage
     * @param {Object} postData 
     */
    savePost(postData) {
        chrome.runtime.sendMessage({
            action: 'post_found',
            payload: postData
        }).catch(() => {
            // Background may not be ready, store locally
            this.storeLocally(postData);
        });

        // Update popup counter
        chrome.runtime.sendMessage({
            action: 'post_count_updated',
            count: this.lruCache.size
        }).catch(() => { });
    }

    /**
     * Store post locally as fallback
     * @param {Object} postData 
     */
    async storeLocally(postData) {
        const result = await chrome.storage.local.get(['pendingPosts']);
        const pending = result.pendingPosts || [];
        pending.push(postData);
        await chrome.storage.local.set({ pendingPosts: pending.slice(-100) }); // Keep last 100
    }

    /**
     * Scan existing posts on page
     */
    scanExistingPosts() {
        setTimeout(() => {
            const allPosts = document.querySelectorAll(
                'article, a[href*="/p/"], a[href*="/reel/"]'
            );

            console.log(`📊 Scan iniziale: ${allPosts.length} elementi trovati`);

            allPosts.forEach(post => {
                const container = this.findPostContainer(post);
                if (container && !this.isAlreadyObserved(container)) {
                    this.markAsObserved(container);
                    this.intersectionObserver.observe(container);
                }
            });
        }, 1500); // Wait for page to stabilize
    }

    /**
     * Setup listener for SPA navigation
     */
    setupNavigationListener() {
        // Disconnect existing observer if any (prevent duplicates)
        if (this.navigationObserver) {
            this.navigationObserver.disconnect();
        }

        let lastUrl = location.href;

        // Watch for URL changes - store reference to prevent memory leak
        this.navigationObserver = new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                console.log('📍 Navigazione rilevata:', lastUrl);

                if (this.isMonitoring) {
                    // Re-scan for new posts after navigation
                    setTimeout(() => this.scanExistingPosts(), 2000);
                }
            }
        });

        this.navigationObserver.observe(document.body, { subtree: true, childList: true });
    }

    /**
     * Request data export
     */
    requestExport() {
        chrome.runtime.sendMessage({ action: 'export_posts' });
    }

    /**
     * Show visual notification on page
     * @param {string} message 
     * @param {string} type 
     */
    showNotification(message, type = 'info') {
        const existing = document.querySelector('.insta-monitor-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = `insta-monitor-notification insta-monitor-${type}`;
        notification.textContent = `📸 ${message}`;
        document.body.appendChild(notification);

        // Animate in
        requestAnimationFrame(() => {
            notification.classList.add('show');
        });

        // Remove after delay
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 2500);
    }

    /**
     * Highlight processed post briefly
     * @param {Element} element 
     */
    highlightPost(element) {
        element.classList.add('insta-monitor-highlight');
        setTimeout(() => {
            element.classList.remove('insta-monitor-highlight');
        }, 800);
    }

    /**
     * Random delay helper
     * @param {number} min 
     * @param {number} max 
     * @returns {Promise}
     */
    randomDelay(min, max) {
        const delay = Math.floor(Math.random() * (max - min + 1)) + min;
        return new Promise(resolve => setTimeout(resolve, delay));
    }
}

// Initialize monitor when document is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.instagramMonitor = new InstagramMonitor();
    });
} else {
    window.instagramMonitor = new InstagramMonitor();
}
