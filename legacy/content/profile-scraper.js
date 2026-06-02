/**
 * Profile Scraper - Automated profile post extraction
 * Scrolls through a profile and extracts posts up to a configurable limit
 */
class ProfileScraper {
    constructor(options = {}) {
        this.postLimit = options.postLimit || 100;
        this.rateLimiter = new RateLimiter(options.mode || 'safe');
        this.extractedPosts = [];
        this.isRunning = false;
        this.isPaused = false;
        this.onProgress = options.onProgress || (() => { });
        this.onComplete = options.onComplete || (() => { });
        this.onError = options.onError || (() => { });
        this.seenUrls = new Set();
        // Store original profile URL for returning after modal clicks
        this.profileUrl = window.location.pathname.replace(/\//g, '');
    }

    /**
     * Start scraping the current profile
     * @returns {Promise<Object>}
     */
    async startScraping() {
        if (this.isRunning) {
            console.warn('⚠️ Scraper already running');
            return { success: false, error: 'already_running' };
        }

        // Verify we're on a profile page
        if (!this.isProfilePage()) {
            this.onError({ error: 'not_profile_page' });
            return { success: false, error: 'not_profile_page' };
        }

        this.isRunning = true;
        this.isPaused = false;
        this.extractedPosts = [];
        this.seenUrls.clear();

        console.log(`🚀 Starting profile scrape (limit: ${this.postLimit}, mode: ${this.rateLimiter.getMode()})`);

        // BUG-003 FIX: Reset fatigue for fresh session
        if (typeof this.rateLimiter.resetFatigue === 'function') {
            this.rateLimiter.resetFatigue();
            console.log('💪 Fatigue reset for new scrape session');
        }

        try {
            // Extract profile metadata first
            const profileInfo = this.extractProfileInfo();

            // Scroll and extract posts
            await this.scrollAndExtract();

            const result = {
                success: true,
                profileInfo,
                posts: this.extractedPosts,
                totalExtracted: this.extractedPosts.length,
                mode: this.rateLimiter.getMode()
            };

            this.onComplete(result);
            return result;

        } catch (error) {
            console.error('❌ Scrape error:', error);
            const errorResult = { success: false, error: error.message };
            this.onError(errorResult);
            return errorResult;
        } finally {
            this.isRunning = false;
        }
    }

    /**
     * Stop scraping
     */
    stopScraping() {
        console.log('🛑 Stopping scrape...');
        this.isRunning = false;

        // BUG-003 FIX: Exit safe mode if active - user explicitly stopped
        if (this.rateLimiter?.backoffState?.inSafeMode) {
            console.log('🟢 Exiting safe mode on explicit stop');
            this.rateLimiter.exitSafeMode();
        }
    }

    /**
     * Pause/resume scraping
     */
    togglePause() {
        this.isPaused = !this.isPaused;
        console.log(this.isPaused ? '⏸️ Paused' : '▶️ Resumed');
    }

    /**
     * Check if current page is a profile
     * @returns {boolean}
     */
    isProfilePage() {
        const path = window.location.pathname;
        // Profile pages are /{username}/ (not /p/, /reel/, /explore/, etc.)
        const invalidPaths = ['/p/', '/reel/', '/explore/', '/direct/', '/stories/', '/accounts/'];
        return !invalidPaths.some(p => path.includes(p)) &&
            path.split('/').filter(Boolean).length === 1;
    }

    /**
     * Extract profile metadata
     * @returns {Object}
     */
    extractProfileInfo() {
        const info = {
            username: null,
            displayName: null,
            bio: null,
            followerCount: 0,
            followingCount: 0,
            postCount: 0,
            isVerified: false,
            isPrivate: false,
            profilePicUrl: null,
            website: null
        };

        try {
            // Username from URL
            info.username = window.location.pathname.replace(/\//g, '');

            // Profile header section
            const header = document.querySelector('header section');
            if (header) {
                // Display name
                const nameEl = header.querySelector('span[class*="x1lliihq"]') ||
                    header.querySelector('h2');
                info.displayName = nameEl?.textContent?.trim() || info.username;

                // Verified badge
                info.isVerified = !!header.querySelector('svg[aria-label*="Verified"]') ||
                    !!header.querySelector('[title*="Verified"]');
            }

            // Bio
            const bioSelectors = [
                'header section div > span',
                'div[class*="bio"]',
                'section > div > span'
            ];
            for (const sel of bioSelectors) {
                const bioEl = document.querySelector(sel);
                if (bioEl && bioEl.textContent?.length > 20) {
                    info.bio = bioEl.textContent.trim();
                    break;
                }
            }

            // Stats (posts, followers, following)
            const statsContainer = document.querySelector('header section ul') ||
                document.querySelector('header ul');
            if (statsContainer) {
                const statItems = statsContainer.querySelectorAll('li');
                statItems.forEach((item, index) => {
                    const text = item.textContent || '';
                    const num = this.parseStatNumber(text);
                    if (index === 0) info.postCount = num;
                    else if (index === 1) info.followerCount = num;
                    else if (index === 2) info.followingCount = num;
                });
            }

            // Profile picture
            const profilePic = document.querySelector('header img[alt*="profile"]') ||
                document.querySelector('header img[src*="cdninstagram"]');
            info.profilePicUrl = profilePic?.src || null;

            // Private account check
            info.isPrivate = !!document.querySelector('[class*="PrivateAccount"]') ||
                document.body.textContent?.includes('This Account is Private');

            console.log('📊 Profile info:', info);
            return info;

        } catch (e) {
            console.error('Error extracting profile info:', e);
            return info;
        }
    }

    /**
     * Main scroll and extraction loop
     */
    async scrollAndExtract() {
        let noNewPostsCount = 0;
        const maxNoNewPosts = 5; // Stop after 5 scrolls with no new posts

        while (this.isRunning && this.extractedPosts.length < this.postLimit) {
            // Check for pause
            while (this.isPaused && this.isRunning) {
                await this.rateLimiter.sleep(500);
            }

            if (!this.isRunning) break;

            // Find all post links
            const postLinks = this.findPostLinks();
            const newPosts = postLinks.filter(url => !this.seenUrls.has(url));

            if (newPosts.length === 0) {
                noNewPostsCount++;
                if (noNewPostsCount >= maxNoNewPosts) {
                    console.log('📭 No more posts found, stopping');
                    break;
                }
            } else {
                noNewPostsCount = 0;
            }

            // Extract data from new posts
            for (const postUrl of newPosts) {
                if (this.extractedPosts.length >= this.postLimit) break;
                if (!this.isRunning) break;

                this.seenUrls.add(postUrl);

                // Find the post element
                const postEl = this.findPostElement(postUrl);
                if (postEl) {
                    await this.rateLimiter.waitForSlot();

                    const data = await this.extractPostData(postEl, postUrl);
                    if (data) {
                        this.extractedPosts.push(data);

                        // Progress callback
                        this.onProgress({
                            current: this.extractedPosts.length,
                            total: this.postLimit,
                            percentage: Math.round((this.extractedPosts.length / this.postLimit) * 100),
                            lastPost: data
                        });
                    }
                }
            }

            // Scroll down
            await this.smoothScroll();
            await this.rateLimiter.sleep(this.rateLimiter.getScrollDelay());
        }

        console.log(`✅ Extracted ${this.extractedPosts.length} posts`);
    }

    /**
     * Find all post links on the page
     * @returns {Array<string>}
     */
    findPostLinks() {
        const links = document.querySelectorAll('a[href*="/p/"], a[href*="/reel/"]');
        const urls = [];

        links.forEach(link => {
            const href = link.getAttribute('href');
            if (href) {
                const match = href.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
                if (match) {
                    const url = `https://www.instagram.com/${match[1]}/${match[2]}/`;
                    if (!urls.includes(url)) {
                        urls.push(url);
                    }
                }
            }
        });

        return urls;
    }
    /**
     * Find the DOM element for a post
     * @param {string} postUrl
     * @returns {Element|null}
     */
    findPostElement(postUrl) {
        // Extract shortcode from URL
        const shortcode = postUrl.split('/').slice(-2, -1)[0];

        if (!shortcode) {
            console.warn('⚠️ Could not extract shortcode from:', postUrl);
            return null;
        }

        // Find the link with this specific shortcode
        const link = document.querySelector(`a[href*="${shortcode}"]`);

        if (link) {
            // Navigate up to find the container (grid item)
            const container = link.closest('article') ||
                link.closest('div[class*="post"]') ||
                link.closest('div._aabd') || // Instagram grid item class
                link.parentElement?.parentElement?.parentElement;
            return container || link;
        }

        console.warn('⚠️ Post element not found for:', shortcode);
        return null;
    }

    /**
     * Extract data from a post element using the configured mode
     * @param {Element} element - Grid element
     * @param {string} postUrl - Post URL
     * @returns {Promise<Object|null>}
     */
    async extractPostData(element, postUrl) {
        const mode = this.rateLimiter.getMode();

        try {
            switch (mode) {
                case 'fast':
                    return await this.extractFastMode(element, postUrl);
                case 'full':
                    return await this.extractFullMode(element, postUrl);
                case 'hybrid':
                default:
                    return await this.extractHybridMode(element, postUrl);
            }
        } catch (e) {
            console.error(`❌ Extraction error (${mode}):`, e);
            return null;
        }
    }

    /**
     * FAST MODE: Extract only grid data (no caption, maximum speed)
     * @param {Element} element
     * @param {string} postUrl
     * @returns {Promise<Object>}
     */
    async extractFastMode(element, postUrl) {
        const imageUrl = element.querySelector('img[src*="cdninstagram"]')?.src || null;
        const isReel = postUrl.includes('/reel/');

        // Trigger hover to reveal stats (hidden by default in grid)
        try {
            const mouseoverEvent = new MouseEvent('mouseover', {
                view: window,
                bubbles: true,
                cancelable: true
            });
            element.dispatchEvent(mouseoverEvent);
            // Short delay for UI update
            await new Promise(r => setTimeout(r, 50));
        } catch (e) {
            // Continue if trigger fails
        }

        // Best-effort metrics from grid captions/alt text
        const statsText = element.textContent || '';
        const extractor = new InstagramExtractor(element);
        const likes = extractor.parseNumber(statsText.match(/(\d+[.,\d]*[KkMm]?)\s*(?:mi piace|likes)/i)?.[1]) || 0;
        const comments = extractor.parseNumber(statsText.match(/(\d+[.,\d]*[KkMm]?)\s*(?:commenti|comments)/i)?.[1]) || 0;

        return {
            postUrl,
            imageUrl,
            videoUrl: null,
            caption: '', // Fast mode doesn't extract captions
            fullCaption: '',
            likes: likes,
            comments: comments,
            commentPreviews: [],
            timestamp: new Date().toISOString(),
            userInfo: this.extractProfileInfoFromPage(),
            hashtags: [],
            mentions: [],
            location: null,
            postType: isReel ? 'reel' : (this.detectCarouselFromGrid(element) ? 'carousel' : 'image'),
            engagementRate: 0,
            isCarousel: this.detectCarouselFromGrid(element),
            carouselCount: 1,
            audioInfo: null,
            viewCount: 0,
            scrapedAt: Date.now(),
            scrapeMode: 'fast',
            captionNote: '⚡ Fast mode: caption limited'
        };
    }

    /**
     * FULL MODE: Click post to open modal, extract complete data
     * @param {Element} element
     * @param {string} postUrl
     * @returns {Promise<Object>}
     */
    async extractFullMode(element, postUrl) {
        // Extract the post shortcode from the URL
        const shortcode = postUrl.split('/').slice(-2, -1)[0];

        // Scroll the element into view to ensure we're targeting the right one
        element.scrollIntoView({ block: 'center', behavior: 'instant' });
        await this.rateLimiter.sleep(200);

        // Find the SPECIFIC link matching this postUrl (not just any link)
        const link = element.querySelector(`a[href*="${shortcode}"]`) ||
            document.querySelector(`a[href*="${shortcode}"]`);

        if (!link) {
            console.warn('⚠️ No link found for shortcode:', shortcode);
            return this.extractFastMode(element, postUrl);
        }

        console.log('🔗 Clicking post:', shortcode);

        // Click to open modal
        link.click();

        // Wait for modal to appear
        const modal = await this.waitForModal(3000);
        if (!modal) {
            console.warn('⚠️ Modal didn\'t open, falling back to fast mode');
            return this.extractFastMode(element, postUrl);
        }

        try {
            // Verify we opened the correct post by checking URL
            if (!window.location.pathname.includes(shortcode)) {
                console.warn('⚠️ Wrong post opened! Expected:', shortcode, 'Got:', window.location.pathname);
            }

            // Extract data from modal
            const extractor = new InstagramExtractor(modal);
            const data = await extractor.extract();

            return {
                ...data,
                postUrl,
                scrapedAt: Date.now(),
                scrapeMode: 'full'
            };
        } finally {
            // Always close modal
            await this.closeModal();
            // Longer delay to let Instagram settle and DOM stabilize
            await this.rateLimiter.sleep(500);
        }
    }

    /**
     * HYBRID MODE: Fetch post page in background, extract from HTML
     * @param {Element} element
     * @param {string} postUrl
     * @returns {Promise<Object>}
     */
    async extractHybridMode(element, postUrl) {
        try {
            // Request background to fetch the post page
            const response = await chrome.runtime.sendMessage({
                action: 'fetch_post_data',
                postUrl: postUrl
            });

            if (response?.success && response.data) {
                this.rateLimiter.recordSuccess();
                return {
                    ...response.data,
                    postUrl,
                    scrapedAt: Date.now(),
                    scrapeMode: 'hybrid'
                };
            }

            // BUG-009 FIX: Record error to trigger RateLimiter backoff
            if (response?.statusCode) {
                this.rateLimiter.recordError(response.statusCode);
            }
        } catch (e) {
            console.warn('⚠️ Hybrid fetch failed:', e.message);
        }

        // Fallback: try meta tags extraction
        const metaData = await this.extractFromMetaTags(postUrl);
        if (metaData) {
            return {
                ...metaData,
                postUrl,
                scrapedAt: Date.now(),
                scrapeMode: 'hybrid-meta'
            };
        }

        // Final fallback to fast mode
        return this.extractFastMode(element, postUrl);
    }

    /**
     * Wait for Instagram modal to appear
     * @param {number} timeout - Maximum wait time in ms
     * @returns {Promise<Element|null>}
     */
    async waitForModal(timeout = 3000) {
        const startTime = Date.now();
        const modalSelectors = [
            'div[role="dialog"] article',
            'div[role="dialog"][aria-modal="true"]',
            'div[class*="Modal"] article'
        ];

        while (Date.now() - startTime < timeout) {
            for (const selector of modalSelectors) {
                const modal = document.querySelector(selector);
                if (modal) {
                    // Wait a bit for content to load
                    await this.rateLimiter.sleep(500);
                    return modal;
                }
            }
            await this.rateLimiter.sleep(100);
        }

        return null;
    }

    /**
     * Close the currently open modal with timeout protection
     * BUG-002: Prevents infinite loops when modal fails to close
     * @returns {Promise<void>}
     */
    async closeModal() {
        const CLOSE_TIMEOUT = 8000;

        try {
            await Promise.race([
                this._closeModalInternal(),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error('Modal close timeout')), CLOSE_TIMEOUT)
                )
            ]);
        } catch (e) {
            console.error('❌ Modal close failed:', e.message || e);
            // Force navigate as last resort
            const originalUrl = this.profileUrl || window.location.pathname.split('/')[1];
            const profileUrl = `https://www.instagram.com/${originalUrl}/`;
            if (!window.location.href.includes(originalUrl + '/') ||
                window.location.pathname.includes('/p/') ||
                window.location.pathname.includes('/reel/')) {
                console.log('🔄 Force navigating to profile after timeout');
                window.location.href = profileUrl;
                await this.rateLimiter.sleep(1500);
            }
        }
    }

    /**
     * Internal modal close logic - tries multiple strategies
     * @returns {Promise<void>}
     */
    async _closeModalInternal() {
        const originalUrl = this.profileUrl || window.location.pathname.split('/')[1];
        const beforeUrl = window.location.href;

        console.log('🔙 Closing modal, returning to:', originalUrl);

        // Method 1: Use browser history back (most reliable for Instagram modals)
        window.history.back();

        // Wait for URL to change back to profile
        const startTime = Date.now();
        const maxWait = 3000;

        while (Date.now() - startTime < maxWait) {
            await this.rateLimiter.sleep(150);

            // Check if we're back on profile page (not on a post/reel URL)
            const currentPath = window.location.pathname;
            if (window.location.href !== beforeUrl &&
                !currentPath.includes('/p/') &&
                !currentPath.includes('/reel/')) {
                console.log('✅ Modal closed via history.back()');
                await this.rateLimiter.sleep(300); // Let page settle
                return;
            }

            // Check if modal is gone but URL didn't change (Instagram modal overlay)
            const modal = document.querySelector('div[role="dialog"]');
            if (!modal && !currentPath.includes('/p/') && !currentPath.includes('/reel/')) {
                console.log('✅ Modal dismissed');
                await this.rateLimiter.sleep(200);
                return;
            }
        }

        // Method 2: Press Escape key
        console.log('⚠️ history.back() didn\'t work, trying Escape...');
        document.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Escape',
            keyCode: 27,
            bubbles: true,
            cancelable: true
        }));
        await this.rateLimiter.sleep(400);

        // Check if escape worked
        if (!window.location.pathname.includes('/p/') && !window.location.pathname.includes('/reel/')) {
            console.log('✅ Modal closed via Escape');
            return;
        }

        // Method 3: Click close button
        console.log('⚠️ Escape didn\'t work, looking for close button...');
        const closeSelectors = [
            'div[role="dialog"] button[aria-label*="Close"]',
            'div[role="dialog"] svg[aria-label*="Close"]',
            '[aria-label="Chiudi"]',
            'button[aria-label="Close"]',
            'div[role="dialog"] button:first-child', // Sometimes the X is the first button
            'svg[aria-label="Chiudi"]'
        ];

        for (const selector of closeSelectors) {
            const el = document.querySelector(selector);
            if (el) {
                const btn = el.closest('button') || el;
                btn.click();
                await this.rateLimiter.sleep(400);

                if (!window.location.pathname.includes('/p/') && !window.location.pathname.includes('/reel/')) {
                    console.log('✅ Modal closed via button click');
                    return;
                }
            }
        }

        // Method 4: Force navigate back to profile
        console.log('⚠️ All close methods failed, force navigating to profile...');
        const profileUrl = `https://www.instagram.com/${originalUrl}/`;

        if (window.location.href !== profileUrl) {
            window.location.href = profileUrl;

            // Wait for navigation to complete
            await new Promise(resolve => {
                const checkNav = setInterval(() => {
                    if (!window.location.pathname.includes('/p/') &&
                        !window.location.pathname.includes('/reel/')) {
                        clearInterval(checkNav);
                        resolve();
                    }
                }, 200);
                // Timeout after 5 seconds
                setTimeout(() => {
                    clearInterval(checkNav);
                    resolve();
                }, 5000);
            });

            // Wait for page to load
            await this.rateLimiter.sleep(1500);
            console.log('✅ Force navigated to profile');
        }
    }

    /**
     * Detect if a grid item is a carousel
     * @param {Element} element
     * @returns {boolean}
     */
    detectCarouselFromGrid(element) {
        // Look for carousel indicator icon in grid
        return !!element.querySelector('svg[aria-label*="Carousel"]') ||
            !!element.querySelector('[aria-label*="carousel"]') ||
            !!element.querySelector('div[class*="Carousel"]');
    }

    /**
     * Extract user info from current profile page
     * @returns {Object}
     */
    extractProfileInfoFromPage() {
        const username = window.location.pathname.replace(/\//g, '');
        const header = document.querySelector('header');
        const profileImg = header?.querySelector('img[alt*="profile picture"]')?.src ||
            header?.querySelector('img[src*="cdninstagram"]')?.src;

        return {
            username,
            displayName: username,
            profileUrl: window.location.href,
            profileImage: profileImg || null
        };
    }

    /**
     * Fetch caption from post's meta tags via service worker
     * BUG-001: Route through service worker to avoid credential leakage
     * @param {string} postUrl
     * @returns {Promise<Object|null>}
     */
    async extractFromMetaTags(postUrl) {
        try {
            // Use service worker to fetch (handles credentials properly)
            const response = await chrome.runtime.sendMessage({
                action: 'fetch_post_data',
                postUrl: postUrl
            });

            if (response?.success && response.data) {
                this.rateLimiter.recordSuccess();
                return {
                    caption: response.data.caption || '',
                    fullCaption: response.data.fullCaption || '',
                    imageUrl: response.data.imageUrl || null,
                    userInfo: response.data.userInfo || this.extractProfileInfoFromPage(),
                    hashtags: response.data.hashtags || this.extractHashtagsFromText(response.data.caption || ''),
                    mentions: response.data.mentions || this.extractMentionsFromText(response.data.caption || ''),
                    postType: postUrl.includes('/reel/') ? 'reel' : 'image',
                    likes: response.data.likes || 0,
                    comments: response.data.comments || 0,
                    scrapedAt: Date.now(),
                    scrapeMode: 'hybrid'
                };
            }

            if (response?.statusCode) {
                this.rateLimiter.recordError(response.statusCode);
            }
            return null;
        } catch (e) {
            console.warn('⚠️ Meta extraction failed:', e);
            return null;
        }
    }

    /**
     * Extract hashtags from text
     * @param {string} text
     * @returns {Array<string>}
     */
    extractHashtagsFromText(text) {
        if (!text) return [];
        const matches = text.match(/#[\w\u00C0-\u017F]+/gu) || [];
        return [...new Set(matches.map(h => h.slice(1)))];
    }

    /**
     * Extract mentions from text
     * @param {string} text
     * @returns {Array<string>}
     */
    extractMentionsFromText(text) {
        if (!text) return [];
        const matches = text.match(/@[\w._]+/g) || [];
        return [...new Set(matches.map(m => m.slice(1)))];
    }


    /**
     * Perform smooth human-like scroll
     */
    async smoothScroll() {
        const scrollAmount = 400 + RateLimiter.secureRandom() * 300; // 400-700px
        const duration = 300 + RateLimiter.secureRandom() * 200; // 300-500ms
        const startY = window.scrollY;
        const startTime = performance.now();

        return new Promise(resolve => {
            const step = (currentTime) => {
                const elapsed = currentTime - startTime;
                const progress = Math.min(elapsed / duration, 1);

                // Ease out curve for natural feel
                const easeOut = 1 - Math.pow(1 - progress, 3);
                window.scrollTo(0, startY + scrollAmount * easeOut);

                if (progress < 1) {
                    requestAnimationFrame(step);
                } else {
                    resolve();
                }
            };
            requestAnimationFrame(step);
        });
    }

    /**
     * Parse stat number from text like "1.2K followers"
     * @param {string} text
     * @returns {number}
     */
    parseStatNumber(text) {
        if (!text) return 0;
        const clean = text.toLowerCase().replace(/[,.\s]/g, '');

        const match = clean.match(/(\d+(?:\.\d+)?)(k|m)?/i);
        if (!match) return 0;

        let num = parseFloat(match[1]);
        if (match[2] === 'k') num *= 1000;
        if (match[2] === 'm') num *= 1000000;

        return Math.round(num);
    }

    /**
     * Get current status
     * @returns {Object}
     */
    getStatus() {
        return {
            isRunning: this.isRunning,
            isPaused: this.isPaused,
            extractedCount: this.extractedPosts.length,
            postLimit: this.postLimit,
            mode: this.rateLimiter.getMode(),
            rateLimiterStatus: this.rateLimiter.getStatus()
        };
    }

    /**
     * Update settings
     * @param {Object} options
     */
    updateSettings(options) {
        if (options.postLimit) this.postLimit = options.postLimit;
        if (options.mode) this.rateLimiter.setMode(options.mode);
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.ProfileScraper = ProfileScraper;
}
