/**
 * Instagram Data Extractor
 * Extracts post data from Instagram DOM elements
 */
class InstagramExtractor {
    constructor(element) {
        this.element = element;
    }

    /**
     * Extract all available data from the post element
     * @returns {Promise<Object>} Extracted post data
     */
    async extract() {
        const caption = this.extractCaption();
        return {
            postUrl: this.extractPostUrl(),
            imageUrl: this.extractImageUrl(),
            videoUrl: this.extractVideoUrl(),
            caption: caption,
            fullCaption: this.extractFullCaption(), // NEW: full caption with formatting
            likes: this.extractLikes(),
            comments: this.extractComments(),
            commentPreviews: this.extractCommentPreviews(), // NEW: actual comment text
            timestamp: this.extractTimestamp(),
            userInfo: this.extractUserInfo(),
            hashtags: this.extractHashtagsFromText(caption),
            mentions: this.extractMentionsFromText(caption),
            location: this.extractLocation(),
            postType: this.detectPostType(),
            engagementRate: this.calculateEngagement(),
            isCarousel: this.detectCarousel(),
            carouselCount: this.getCarouselCount(),
            audioInfo: this.extractAudioInfo(), // NEW: reel audio info
            viewCount: this.extractViewCount() // NEW: for reels
        };
    }

    /**
   * Extract post URL from link elements
   * @returns {string|null}
   */
    extractPostUrl() {
        const selectors = [
            'a[href*="/p/"]',
            'a[href*="/reel/"]'
        ];

        for (const selector of selectors) {
            const links = this.element.querySelectorAll(selector);
            for (const link of links) {
                const href = link.getAttribute('href');
                if (!href) continue;

                // Skip invalid URLs (liked_by, comments, etc.)
                if (href.includes('/liked_by') ||
                    href.includes('/comments') ||
                    href.includes('/share') ||
                    href.includes('/save')) {
                    continue;
                }

                // Must be a valid post or reel URL - extract clean post ID
                const match = href.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
                if (match) {
                    const type = match[1];
                    const postId = match[2];
                    return `https://www.instagram.com/${type}/${postId}/`;
                }
            }
        }

        return null;
    }

    /**
     * Extract main image URL
     * @returns {string|null}
     */
    extractImageUrl() {
        const imgSelectors = [
            'img[src*="cdninstagram.com"]',
            'img[style*="object-fit: cover"]',
            'article img[src*="instagram"]',
            'div[role="button"] img[src*="instagram"]',
            'img[srcset*="cdninstagram.com"]'
        ];

        for (const selector of imgSelectors) {
            const imgs = this.element.querySelectorAll(selector);
            for (const img of imgs) {
                // Try srcset first for higher quality
                const srcset = img.getAttribute('srcset');
                if (srcset) {
                    const urls = srcset.split(',').map(s => s.trim().split(' ')[0]);
                    const highQuality = urls[urls.length - 1];
                    if (highQuality && highQuality.includes('cdninstagram.com')) {
                        return this.cleanImageUrl(highQuality);
                    }
                }

                const src = img.getAttribute('src');
                if (src && src.includes('cdninstagram.com')) {
                    return this.cleanImageUrl(src);
                }
            }
        }

        return null;
    }

    /**
     * Clean image URL by removing unnecessary parameters
     * @param {string} url 
     * @returns {string}
     */
    cleanImageUrl(url) {
        try {
            const parsed = new URL(url);
            // Keep only essential parameters
            return `${parsed.origin}${parsed.pathname}`;
        } catch {
            return url.split('?')[0];
        }
    }

    /**
     * Extract video URL if present
     * @returns {string|null}
     */
    extractVideoUrl() {
        const video = this.element.querySelector('video');
        if (video) {
            const src = video.getAttribute('src');
            if (src) return src;

            const source = video.querySelector('source');
            if (source) return source.getAttribute('src');
        }
        return null;
    }

    /**
     * Extract post caption (short version)
     * Filters out audio names, likes text, and tagged/mentioned users
     * Falls back to first comment if caption is empty (common Instagram pattern)
     * @returns {string}
     */
    extractCaption() {
        const captionSelectors = [
            // Modal view - caption is in first comment-like element
            'article ul > div > li:first-child h1',
            'article ul > div > li:first-child span[dir="auto"]',
            // Individual post page selectors
            'article h1 + div span[dir="auto"]',
            'div[data-testid="post-comment-root"] span[dir="auto"]',
            // Caption container with specific structure
            'article section + div span[dir="auto"]',
            // Fallback selectors
            'article div[class*="Caption"] span[dir="auto"]'
        ];

        for (const selector of captionSelectors) {
            try {
                const elements = this.element.querySelectorAll(selector);
                for (const element of elements) {
                    const text = element.textContent?.trim();

                    // Skip empty or too short
                    if (!text || text.length < 10) continue;

                    // Skip if it's likely audio/music info (contains • or only has artist-track pattern)
                    if (this.isLikelyAudioName(text)) continue;

                    // Skip if it's likes text
                    if (this.isLikelyLikesText(text)) continue;

                    // Skip if it starts with @ (just mentions)
                    if (text.startsWith('@')) continue;

                    // Skip common UI text
                    if (text.includes('Visualizza tutti') || text.includes('View all') ||
                        text.includes('Rispondi') || text.includes('Reply') ||
                        text.includes('Aggiungi un commento') || text.includes('Add a comment')) continue;

                    // Skip if it's just usernames joined by "e" (tagged collaborators)
                    if (this.isLikelyTaggedUsers(text)) continue;

                    return text;
                }
            } catch (e) {
                continue;
            }
        }

        // Fallback: Try to get caption from first comment (some users post caption as first comment)
        const firstCommentCaption = this.extractFirstCommentAsCaption();
        if (firstCommentCaption) {
            return firstCommentCaption;
        }

        return '';
    }

    /**
     * Extract first comment text as potential caption
     * Some Instagram users post their main caption as the first comment
     * @returns {string}
     */
    extractFirstCommentAsCaption() {
        // Look for comments list - skip the first item if it's the poster's caption
        const commentSelectors = [
            // Modal view - comments are in ul > li after the first (caption) item
            'article ul > div > li:nth-child(2) span[dir="auto"]',
            // Also check second-level list items
            'article ul li:nth-child(2) > div span[dir="auto"]',
            // Comment containers
            'ul > li:not(:first-child) div span[dir="auto"]'
        ];

        for (const selector of commentSelectors) {
            try {
                const elements = this.element.querySelectorAll(selector);
                for (const element of elements) {
                    const text = element.textContent?.trim();

                    // Skip empty or very short
                    if (!text || text.length < 15) continue;

                    // Skip if it's audio name
                    if (this.isLikelyAudioName(text)) continue;

                    // Skip if it's likes text  
                    if (this.isLikelyLikesText(text)) continue;

                    // Skip usernames-only text
                    if (this.isLikelyTaggedUsers(text)) continue;

                    // Skip common reply patterns
                    if (text.startsWith('@') && text.length < 50) continue;

                    // Skip UI text
                    if (text.includes('Visualizza') || text.includes('View all') ||
                        text.includes('Rispondi') || text.includes('Reply')) continue;

                    // Found a substantial first comment - likely the caption
                    return text;
                }
            } catch (e) {
                continue;
            }
        }

        return '';
    }

    /**
     * Check if text looks like audio/music info (artist•track pattern)
     * @param {string} text 
     * @returns {boolean}
     */
    isLikelyAudioName(text) {
        // Contains bullet separator used in Instagram audio names
        if (text.includes('•')) return true;

        // Very short with no spaces (likely a name)
        if (text.length < 30 && !text.includes(' ')) return true;

        return false;
    }

    /**
     * Check if text is likes count text
     * @param {string} text 
     * @returns {boolean}
     */
    isLikelyLikesText(text) {
        const likesPatterns = [
            /^Piace a .* e altri/i,        // Italian: "Piace a X e altri Y"
            /^Piace a \d+/i,               // Italian: "Piace a 1234 persone"
            /^\d+ (like|mi piace)/i,       // "1234 likes" or "1234 mi piace"
            /^Liked by/i,                  // English: "Liked by X and others"
            /persone$/i,                   // Ends with "persone"
            /others$/i                     // Ends with "others" 
        ];

        return likesPatterns.some(pattern => pattern.test(text));
    }

    /**
     * Check if text is just tagged collaborators
     * @param {string} text 
     * @returns {boolean}
     */
    isLikelyTaggedUsers(text) {
        // Pattern: username e username e username (with "e" as Italian "and")
        // or just usernames without spaces
        const parts = text.split(/\s*e\s*/);
        if (parts.length >= 2) {
            // Check if all parts look like usernames (no spaces, short)
            const allUsernames = parts.every(part => {
                const trimmed = part.trim();
                return trimmed.length > 0 &&
                    trimmed.length < 40 &&
                    !trimmed.includes(' ') &&
                    /^[a-z0-9._]+$/i.test(trimmed);
            });
            if (allUsernames) return true;
        }

        // Single username pattern
        if (text.length < 40 && !text.includes(' ') && /^[a-z0-9._]+$/i.test(text)) {
            return true;
        }

        return false;
    }

    /**
     * Extract full caption with formatting preserved
     * Excludes comments that might appear in the same container
     * @returns {string}
     */
    extractFullCaption() {
        const captionContainerSelectors = [
            // Modal view - the first list item contains the caption (not comments)
            'article ul > div > li:first-child > div > div > div > span[dir="auto"]',
            // More specific: caption spans within first list item
            'article ul > div > li:first-child h1',
            'article ul > div > li:first-child > div > div > span[dir="auto"]',
            // Individual post page - caption container
            'article h1 + div span[dir="auto"]',
            'div[data-testid="post-comment-root"] > div > span[dir="auto"]',
            'article section + div > span[dir="auto"]',
            'article div[class*="Caption"] span[dir="auto"]'
        ];

        for (const selector of captionContainerSelectors) {
            try {
                const elements = this.element.querySelectorAll(selector);
                const textParts = [];

                for (const element of elements) {
                    const text = element.textContent?.trim();
                    if (!text || text.length < 3) continue;

                    // Apply same filtering as extractCaption
                    if (this.isLikelyAudioName(text)) continue;
                    if (this.isLikelyLikesText(text)) continue;
                    if (this.isLikelyTaggedUsers(text)) continue;

                    // Skip if it starts with @ and is short (just a mention)
                    if (text.startsWith('@') && text.length < 40) continue;

                    // Skip common comment indicators
                    if (this.isLikelyComment(text)) continue;

                    textParts.push(text);
                }

                if (textParts.length > 0) {
                    // Take only the first substantial text block (the actual caption)
                    // Avoid concatenating multiple comment previews
                    const firstSubstantial = textParts.find(t => t.length > 20) || textParts[0];
                    if (firstSubstantial && firstSubstantial.length > 15) {
                        return firstSubstantial;
                    }
                }
            } catch (e) {
                continue;
            }
        }

        return this.extractCaption();
    }

    /**
     * Check if text looks like a comment (not the main caption)
     * @param {string} text
     * @returns {boolean}
     */
    isLikelyComment(text) {
        // Comments often are very short emoji-only reactions
        const trimmed = text.trim();
        if (trimmed.length < 10) {
            // Check if it's mostly emojis (simple check)
            const noEmoji = trimmed.replace(/[\u{1F300}-\u{1F9FF}]/gu, '');
            if (noEmoji.length < 3) return true;
        }

        // Comments that are replies (start with @username and are short)
        if (trimmed.startsWith('@') && trimmed.length < 100) {
            return true;
        }

        // Common comment phrases (Italian and English)
        const commentPatterns = [
            /^(wow|bello|bellissim[ao]|amazing|love|gorgeous|beautiful|stunning)$/i,
            /^(che bello|stupendo|fantastico|meraviglioso|perfetto)$/i,
            /^(grazie|thanks|thank you)$/i,
            /^Per te$/i  // Instagram's "For you" indicator
        ];

        return commentPatterns.some(pattern => pattern.test(trimmed));
    }

    /**
     * Extract number of likes
     * @returns {number}
     */
    extractLikes() {
        const likeSelectors = [
            'section span[class*="Like"]',
            'button[class*="Like"] span',
            'a[href*="/liked_by/"] span',
            'span:has(svg[aria-label*="like" i]) + span',
            'div[class*="like"] span'
        ];

        for (const selector of likeSelectors) {
            try {
                const element = this.element.querySelector(selector);
                if (element) {
                    const text = element.textContent?.trim();
                    const likes = this.parseNumber(text);
                    if (likes > 0) return likes;
                }
            } catch (e) {
                continue;
            }
        }

        // Alternative: look for "Piace a X persone" text
        const allText = this.element.textContent;
        const likesMatch = allText?.match(/(\d+[\d.,]*[KkMm]?)\s*(?:mi piace|likes?|piace)/i);
        if (likesMatch) {
            return this.parseNumber(likesMatch[1]);
        }

        return 0;
    }

    /**
     * Extract number of comments
     * @returns {number}
     */
    extractComments() {
        const commentSelectors = [
            'a[href*="/comments/"] span',
            'button[class*="Comment"] span',
            'span[class*="Comment"]',
            // Additional selectors for comment count
            'a[href*="/comments/"]',
            'span:has(svg[aria-label*="Comment" i]) + span'
        ];

        for (const selector of commentSelectors) {
            try {
                const element = this.element.querySelector(selector);
                if (element) {
                    const text = element.textContent?.trim();
                    const comments = this.parseNumber(text);
                    if (comments > 0) return comments;
                }
            } catch (e) {
                continue;
            }
        }

        // Look for "Visualizza tutti i X commenti" text
        const allText = this.element.textContent;
        const commentMatch = allText?.match(/(\d+[\d.,]*[KkMm]?)\s*(?:comment[io]?|commenti|View all)/i);
        if (commentMatch) {
            return this.parseNumber(commentMatch[1]);
        }

        // Alternative: count visible comment elements
        const commentElements = this.element.querySelectorAll('ul li[class*="Comment"]');
        return commentElements.length;
    }

    /**
     * Extract comment previews (first 5 visible comments)
     * @returns {Array<Object>}
     */
    extractCommentPreviews() {
        const comments = [];
        const commentSelectors = [
            'ul > li > div', // Comment containers
            'article ul li div[role="button"]',
            'li[class*="Comment"]'
        ];

        for (const selector of commentSelectors) {
            try {
                const commentElements = this.element.querySelectorAll(selector);

                for (const commentEl of Array.from(commentElements).slice(0, 5)) {
                    // Try to extract username
                    const usernameEl = commentEl.querySelector('a[href^="/"][role="link"]');
                    const username = usernameEl?.textContent?.trim() ||
                        usernameEl?.getAttribute('href')?.replace(/\//g, '') || null;

                    // Skip if no valid username or if it looks like the post author
                    if (!username || username.length < 2 || username.includes('/')) continue;

                    // Extract comment text
                    const textSpans = commentEl.querySelectorAll('span[dir="auto"]');
                    let commentText = '';
                    for (const span of textSpans) {
                        const text = span.textContent?.trim();
                        if (text && text !== username && text.length > 1) {
                            commentText = text;
                            break;
                        }
                    }

                    if (commentText && commentText.length > 2) {
                        // Try to get comment likes
                        const likeEl = commentEl.querySelector('button span, span[class*="like"]');
                        const likes = likeEl ? this.parseNumber(likeEl.textContent) : 0;

                        comments.push({
                            username: username,
                            text: commentText.slice(0, 500), // Limit length
                            likes: likes
                        });
                    }
                }

                if (comments.length > 0) break;
            } catch (e) {
                continue;
            }
        }

        return comments;
    }

    /**
     * Extract audio/music information for reels
     * @returns {Object|null}
     */
    extractAudioInfo() {
        // Only extract for reels
        if (!this.element.querySelector('video')) {
            return null;
        }

        const audioInfo = {
            name: null,
            artist: null,
            audioUrl: null,
            isOriginal: false
        };

        // Try to find audio link
        const audioLinkSelectors = [
            'a[href*="/reels/audio/"]',
            'a[href*="/audio/"]',
            'a[class*="Audio"]',
            'span[class*="Audio"] a'
        ];

        for (const selector of audioLinkSelectors) {
            try {
                const audioLink = this.element.querySelector(selector);
                if (audioLink) {
                    const href = audioLink.getAttribute('href');
                    if (href) {
                        audioInfo.audioUrl = href.startsWith('http') ? href :
                            `https://www.instagram.com${href}`;
                    }

                    // Get audio name from link text
                    const audioName = audioLink.textContent?.trim();
                    if (audioName && audioName.length > 2) {
                        audioInfo.name = audioName;
                    }
                    break;
                }
            } catch (e) {
                continue;
            }
        }

        // Try to find audio name in other locations
        if (!audioInfo.name) {
            const audioNameSelectors = [
                'span[class*="audio"] span',
                'div[class*="AudioInfo"] span',
                'a[href*="/audio/"] span'
            ];

            for (const selector of audioNameSelectors) {
                try {
                    const el = this.element.querySelector(selector);
                    if (el) {
                        const name = el.textContent?.trim();
                        if (name && name.length > 2) {
                            audioInfo.name = name;
                            break;
                        }
                    }
                } catch (e) {
                    continue;
                }
            }
        }

        // Check if it's original audio
        const textContent = this.element.textContent?.toLowerCase() || '';
        if (textContent.includes('original audio') || textContent.includes('audio originale')) {
            audioInfo.isOriginal = true;
        }

        return audioInfo.name || audioInfo.audioUrl ? audioInfo : null;
    }

    /**
     * Extract view count for reels/videos
     * Fixed: :contains() is not valid in querySelector, using iterative approach
     * @returns {number}
     */
    extractViewCount() {
        // Only for videos/reels
        if (!this.element.querySelector('video')) {
            return 0;
        }

        // Try class-based selector first
        const viewEl = this.element.querySelector('span[class*="View"], span[class*="view"]');
        if (viewEl) {
            const views = this.parseNumber(viewEl.textContent);
            if (views > 0) return views;
        }

        // Iterate spans looking for view text (replaces invalid :contains selector)
        const spans = this.element.querySelectorAll('span');
        for (const span of spans) {
            const text = span.textContent?.trim().toLowerCase() || '';
            if (text.includes('view') || text.includes('visualizzazion')) {
                const views = this.parseNumber(text);
                if (views > 0) return views;
            }
        }

        // Try regex on full text as fallback
        const allText = this.element.textContent;
        const viewMatch = allText?.match(/(\d+[\d.,]*[KkMm]?)\s*(?:views?|visualizzazion[ie])/i);
        if (viewMatch) {
            return this.parseNumber(viewMatch[1]);
        }

        return 0;
    }

    /**
     * Extract post timestamp
     * @returns {string}
     */
    extractTimestamp() {
        const timeSelectors = [
            'time[datetime]',
            'a[href*="/p/"] time',
            'article time'
        ];

        for (const selector of timeSelectors) {
            const timeElement = this.element.querySelector(selector);
            if (timeElement) {
                const datetime = timeElement.getAttribute('datetime');
                if (datetime) return datetime;

                const text = timeElement.textContent;
                if (text) return this.parseRelativeTime(text);
            }
        }

        return new Date().toISOString();
    }

    /**
     * Extract user information
     * @returns {Object|null}
     */
    extractUserInfo() {
        const userSelectors = [
            'header a[href^="/"][role="link"]',
            'a[class*="Author"]',
            'header a[href^="/"]',
            'div[role="button"] a[href^="/"]',
            'span[class*="username"] a'
        ];

        for (const selector of userSelectors) {
            try {
                const link = this.element.querySelector(selector);
                if (link) {
                    let href = link.getAttribute('href');
                    if (!href) continue;

                    // Clean href
                    href = href.replace(/\?.*$/, ''); // Remove query params
                    const username = href.replace(/\//g, '').trim();

                    // Skip if not a username (e.g., /p/, /explore/, etc.)
                    if (!username || username.includes('/') ||
                        ['p', 'explore', 'reel', 'reels', 'stories'].includes(username)) {
                        continue;
                    }

                    const displayName = link.textContent?.trim() || username;

                    // Try to get profile image
                    const profileImg = this.element.querySelector(`img[alt*="${username}"]`) ||
                        this.element.querySelector('header img[src*="cdninstagram"]');

                    return {
                        username: username,
                        displayName: displayName,
                        profileUrl: `https://www.instagram.com/${username}/`,
                        profileImage: profileImg?.getAttribute('src') || null
                    };
                }
            } catch (e) {
                continue;
            }
        }

        return null;
    }

    /**
     * Extract hashtags from given text
     * @param {string} text
     * @returns {Array<string>}
     */
    extractHashtagsFromText(text) {
        if (!text) return [];
        const hashtagRegex = /#([\w\u00C0-\u017F]+)/gu;
        const matches = [...text.matchAll(hashtagRegex)];
        return [...new Set(matches.map(match => match[1]))];
    }

    /**
     * Extract mentions from given text
     * @param {string} text
     * @returns {Array<string>}
     */
    extractMentionsFromText(text) {
        if (!text) return [];
        const mentionRegex = /@([\w\._]+)/g;
        const matches = [...text.matchAll(mentionRegex)];
        return [...new Set(matches.map(match => match[1]))];
    }

    /**
     * Extract hashtags from caption (legacy support)
     * @returns {Array<string>}
     */
    extractHashtags() {
        return this.extractHashtagsFromText(this.extractCaption());
    }

    /**
     * Extract mentions from caption (legacy support)
     * @returns {Array<string>}
     */
    extractMentions() {
        return this.extractMentionsFromText(this.extractCaption());
    }

    /**
     * Extract location if present
     * @returns {string|null}
     */
    extractLocation() {
        const locationSelectors = [
            'a[href*="/explore/locations/"]',
            'span[class*="Location"]',
            'a[href*="/locations/"]'
        ];

        for (const selector of locationSelectors) {
            const element = this.element.querySelector(selector);
            if (element) {
                const location = element.textContent?.trim();
                if (location) return location;
            }
        }

        return null;
    }

    /**
     * Detect post type (image, reel, carousel)
     * @returns {string}
     */
    detectPostType() {
        // Check for video/reel
        if (this.element.querySelector('video')) return 'reel';

        // Check for carousel indicators
        if (this.detectCarousel()) return 'carousel';

        // Check for image
        if (this.element.querySelector('img[src*="cdninstagram"]')) return 'image';

        return 'unknown';
    }

    /**
     * Detect if post is a carousel
     * @returns {boolean}
     */
    detectCarousel() {
        const carouselIndicators = [
            'div[class*="Carousel"]',
            'button[aria-label*="Next"]',
            'button[aria-label*="Avanti"]',
            'div[class*="Dots"]',
            '[aria-label*="carousel"]'
        ];

        for (const selector of carouselIndicators) {
            if (this.element.querySelector(selector)) return true;
        }

        return false;
    }

    /**
     * Get number of items in carousel
     * @returns {number}
     */
    getCarouselCount() {
        if (!this.detectCarousel()) return 1;

        // Count dots
        const dots = this.element.querySelectorAll('div[class*="Dot"]');
        if (dots.length > 1) return dots.length;

        return 1;
    }

    /**
     * Calculate estimated engagement rate
     * @returns {number}
     */
    calculateEngagement() {
        const likes = this.extractLikes();
        const comments = this.extractComments();

        // Base engagement (per 1000 estimated followers)
        return parseFloat((((likes + comments * 2) / 1000) * 100).toFixed(2));
    }

    /**
     * Parse number from text (handles K, M suffixes)
     * @param {string} text 
     * @returns {number}
     */
    parseNumber(text) {
        if (!text) return 0;

        // HIGH-003 FIX: Limit input length to prevent ReDoS attacks
        const MAX_INPUT_LENGTH = 100;
        let clean = String(text).slice(0, MAX_INPUT_LENGTH).trim().toLowerCase();

        // Check for suffixes first
        const isK = clean.includes('k');
        const isM = clean.includes('m');

        // Normalize decimal separator to dot
        // If it's like 1,2k or 1.2k, convert to 1.2
        clean = clean.replace(/,/g, '.');

        // Remove everything except numbers, dots, and k/m
        clean = clean.replace(/[^0-9.km]/g, '');

        if (isK) {
            return Math.round(parseFloat(clean) * 1000);
        }
        if (isM) {
            return Math.round(parseFloat(clean) * 1000000);
        }

        // For standard numbers, remove all separators
        const num = parseInt(clean.replace(/\./g, ''));
        return isNaN(num) ? 0 : num;
    }

    /**
     * Parse relative time to ISO string
     * @param {string} text 
     * @returns {string}
     */
    parseRelativeTime(text) {
        const now = new Date();
        const lower = text.toLowerCase();

        // Hours
        const hoursMatch = lower.match(/(\d+)\s*(?:ore?|hours?|h)/);
        if (hoursMatch) {
            now.setHours(now.getHours() - parseInt(hoursMatch[1]));
            return now.toISOString();
        }

        // Days
        const daysMatch = lower.match(/(\d+)\s*(?:giorni?|days?|d)/);
        if (daysMatch) {
            now.setDate(now.getDate() - parseInt(daysMatch[1]));
            return now.toISOString();
        }

        // Weeks
        const weeksMatch = lower.match(/(\d+)\s*(?:settiman[ae]|weeks?|w)/);
        if (weeksMatch) {
            now.setDate(now.getDate() - parseInt(weeksMatch[1]) * 7);
            return now.toISOString();
        }

        // Minutes
        const minsMatch = lower.match(/(\d+)\s*(?:minut[io]?|mins?|m)/);
        if (minsMatch) {
            now.setMinutes(now.getMinutes() - parseInt(minsMatch[1]));
            return now.toISOString();
        }

        return now.toISOString();
    }

    // =========================================================================
    // ENHANCED EXTRACTION METHODS (Phase 2 - Block 2.1.2)
    // =========================================================================

    /**
     * Extract shortcode (post ID) from post URL
     * The shortcode is the unique identifier in Instagram URLs like /p/ABC123/ or /reel/XYZ789/
     * 
     * @returns {string|null}
     */
    extractShortcode() {
        const url = this.extractPostUrl();
        if (!url) return null;

        const match = url.match(/\/(p|reel)\/([A-Za-z0-9_-]+)/);
        return match ? match[2] : null;
    }

    /**
     * Detect the source context where this post was found
     * Useful for analytics to understand where content was discovered
     * 
     * @returns {'feed'|'profile'|'explore'|'reel'|'search'|'unknown'}
     */
    detectSource() {
        const pathname = window.location.pathname;

        if (pathname === '/' || pathname === '/home' || pathname === '/home/') {
            return 'feed';
        }
        if (pathname.startsWith('/explore')) {
            return 'explore';
        }
        if (pathname.startsWith('/reels')) {
            return 'reel';
        }
        if (pathname.includes('/search')) {
            return 'search';
        }
        // Profile pages: /username/ or /username
        if (pathname.match(/^\/[A-Za-z0-9._]+\/?$/)) {
            return 'profile';
        }
        // Individual post pages: /p/ABC123/ or /reel/XYZ/
        if (pathname.includes('/p/') || pathname.includes('/reel/')) {
            return 'profile'; // Accessed via profile likely
        }

        return 'unknown';
    }

    /**
     * Extract complete post data with enhanced metadata
     * This is the recommended method for comprehensive data extraction
     * 
     * Returns all standard data plus:
     * - shortcode: Post ID for API usage
     * - source: Where the post was found
     * - meta: Capture metadata (timestamp, version, session info)
     * 
     * @returns {Promise<Object>}
     */
    async extractComplete() {
        // Get base extraction
        const baseData = await this.extract();

        // Get user info for enhanced data
        const userInfo = baseData.userInfo || {};

        // Calculate enhanced engagement metrics
        const likes = baseData.likes || 0;
        const comments = baseData.comments || 0;
        const views = baseData.viewCount || 0;

        return {
            // === Core Identification ===
            id: this.extractShortcode(),
            shortcode: this.extractShortcode(),
            url: baseData.postUrl,
            type: baseData.postType,

            // === User Data ===
            username: userInfo.username || null,
            userDisplayName: userInfo.displayName || null,
            userProfileUrl: userInfo.profileUrl || null,
            userProfileImage: userInfo.profileImage || null,

            // === Content ===
            imageUrl: baseData.imageUrl,
            videoUrl: baseData.videoUrl,
            caption: baseData.caption,
            captionFull: baseData.fullCaption,
            hashtags: baseData.hashtags || [],
            mentions: baseData.mentions || [],

            // === Engagement ===
            likes: likes,
            comments: comments,
            views: views,
            engagementRate: baseData.engagementRate,

            // === Carousel Info ===
            isCarousel: baseData.isCarousel,
            carouselCount: baseData.carouselCount,

            // === Audio (Reels) ===
            audio: baseData.audioInfo,

            // === Location ===
            location: baseData.location,

            // === Comment Previews ===
            commentPreviews: baseData.commentPreviews || [],

            // === Timestamp ===
            postedAt: baseData.timestamp,

            // === Enhanced Metadata (Block 2.1.2) ===
            meta: {
                capturedAt: new Date().toISOString(),
                source: this.detectSource(),
                extractorVersion: InstagramExtractor.VERSION,
                pageUrl: window.location.href
            }
        };
    }

    /**
     * Quick extraction for high-speed scraping (grid mode)
     * Only extracts essential data, skips expensive operations
     * 
     * @returns {Object}
     */
    extractQuick() {
        return {
            shortcode: this.extractShortcode(),
            url: this.extractPostUrl(),
            imageUrl: this.extractImageUrl(),
            type: this.detectPostType(),
            username: this.extractUserInfo()?.username || null,
            capturedAt: new Date().toISOString()
        };
    }
}

// Version constant for tracking extractor changes
InstagramExtractor.VERSION = '2.1.0';

// Export for content script

// Make available globally
if (typeof window !== 'undefined') {
    window.InstagramExtractor = InstagramExtractor;
}
