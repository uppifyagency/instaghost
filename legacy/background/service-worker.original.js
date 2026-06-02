/**
 * Instagram Monitor - Background Service Worker
 * Handles message routing, data persistence, and exports
 */

importScripts('./db.js');

let postsDB = null;
let isInitialized = false;

// ===== SECURITY UTILITIES =====

/**
 * Escape HTML special characters to prevent XSS
 * @param {string} str - Input string
 * @returns {string} Escaped string
 */
function escapeHtml(str) {
    if (!str || typeof str !== 'string') return '';
    const escapeMap = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
        '/': '&#x2F;',
        '`': '&#x60;',
        '=': '&#x3D;'
    };
    return str.replace(/[&<>"'`=/]/g, char => escapeMap[char]);
}

/**
 * Escape CSV field to prevent formula injection
 * Prefixes dangerous characters with single quote
 * @param {string} str - Input string
 * @returns {string} Safe CSV field
 */
function escapeCSV(str) {
    if (str === null || str === undefined) return '';
    const strVal = String(str);

    // Escape quotes by doubling them
    let escaped = strVal.replace(/"/g, '""');

    // Prevent formula injection - prefix with single quote if starts with dangerous chars
    if (/^[=+\-@\t\r]/.test(escaped)) {
        escaped = "'" + escaped;
    }

    // Replace newlines with spaces
    escaped = escaped.replace(/[\n\r]/g, ' ');

    // Wrap in quotes
    return `"${escaped}"`;
}

/**
 * Validate and sanitize URL
 * @param {string} url - Input URL
 * @returns {string} Safe URL or empty string
 */
function sanitizeUrl(url) {
    if (!url || typeof url !== 'string') return '';
    try {
        const parsed = new URL(url);
        // Only allow https URLs
        if (parsed.protocol !== 'https:') return '';
        return escapeHtml(url);
    } catch {
        return '';
    }
}

// Initialize database on startup
self.addEventListener('activate', async () => {
    console.log('🚀 Service Worker attivato');
    await initializeDB();
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
    try {
        await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
        console.error('Errore apertura side panel:', error);
    }
});

// Set side panel behavior - open on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(error => console.error('Errore setPanelBehavior:', error));


/**
 * Initialize the database with retry logic
 * @param {number} retries - Number of retry attempts
 * @returns {Promise<boolean>} - Success status
 */
async function initializeDB(retries = 3) {
    if (isInitialized) return true;

    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            postsDB = await initDB();
            isInitialized = true;
            console.log('✅ Database pronto');

            // Update badge on init
            updateBadge();

            // Start cleanup scheduler
            scheduleCleanup();
            return true;
        } catch (error) {
            console.error(`❌ Errore inizializzazione DB (tentativo ${attempt}/${retries}):`, error);

            if (attempt < retries) {
                // Wait before retrying (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }

    // All retries failed - show error in badge
    console.error('❌ Database initialization failed after all retries');
    try {
        chrome.action.setBadgeText({ text: '!' });
        chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
    } catch (e) {
        // Badge update failed, ignore
    }
    return false;
}

// Ensure DB is ready before handling messages
initializeDB();

/**
 * Message handler
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender, sendResponse);
    return true; // Keep channel open for async response
});

/**
 * Handle incoming messages
 */
async function handleMessage(message, sender, sendResponse) {
    // Ensure DB is initialized
    if (!isInitialized) {
        await initializeDB();
    }

    try {
        switch (message.action) {
            case 'post_found':
                const result = await handlePostFound(message.payload);
                sendResponse({ success: true, result });
                break;

            case 'fetch_post_data':
                // Hybrid mode: fetch post page in background
                const fetchResult = await fetchPostData(message.postUrl);
                sendResponse(fetchResult);
                break;

            case 'ig_download':
                // Driver A: scarica il knowledge base (Markdown) + dataset (JSON)
                const dlResult = await downloadIgExtract(message.filenameBase, message.markdown, message.json);
                sendResponse(dlResult);
                break;

            case 'ig_progress':
            case 'ig_result':
                // Broadcast del Driver A destinati al side panel: qui no-op
                sendResponse({ success: true });
                break;

            case 'export_posts':
                const exportResult = await exportPosts(message.format || 'json');
                sendResponse(exportResult);
                break;

            case 'export_csv':
                const csvResult = await exportPosts('csv');
                sendResponse(csvResult);
                break;

            case 'get_stats':
                const stats = await getStats();
                sendResponse(stats);
                break;

            case 'get_posts':
                const posts = await getPosts(message.filter || {});
                sendResponse(posts);
                break;

            case 'get_recent_posts':
                const recent = await getRecentPosts(message.limit || 10);
                sendResponse(recent);
                break;

            case 'clear_data':
                await clearData();
                sendResponse({ success: true });
                break;

            case 'monitoring_started':
                await recordSession('started', message.timestamp);
                sendResponse({ success: true });
                break;

            case 'monitoring_stopped':
                await recordSession('stopped', message.timestamp, message.stats);
                sendResponse({ success: true });
                break;

            default:
                sendResponse({ success: false, error: 'Unknown action' });
        }
    } catch (error) {
        console.error('❌ Errore gestione messaggio:', error);
        sendResponse({ success: false, error: error.message });
    }
}

/**
 * Validate that URL is a legitimate Instagram URL
 * CRIT-002 FIX: Prevents cookie leakage to external domains
 * @param {string} url - URL to validate
 * @returns {boolean}
 */
function validateInstagramUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
        const parsed = new URL(url);
        // Only allow HTTPS to instagram.com
        if (parsed.protocol !== 'https:') return false;
        const hostname = parsed.hostname.toLowerCase();
        return hostname === 'www.instagram.com' || hostname === 'instagram.com';
    } catch {
        return false;
    }
}

/**
 * Fetch post data from URL for Hybrid mode
 * @param {string} postUrl - Instagram post URL
 * @returns {Promise<Object>}
 */
async function fetchPostData(postUrl) {
    try {
        // CRIT-002 FIX: Validate domain before fetch to prevent cookie leakage
        if (!validateInstagramUrl(postUrl)) {
            console.error('❌ Invalid Instagram URL:', postUrl);
            return { success: false, error: 'invalid_url' };
        }

        console.log('🔍 Fetching post data:', postUrl);

        const response = await fetch(postUrl, {
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            },
            credentials: 'include'  // SEC-001-FIX: Include session cookies to access private content
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const html = await response.text();

        // Extract data from meta tags - use more flexible patterns
        const ogDescMatch = html.match(/<meta\s+(?:property="og:description"\s+content="([^"]*)"|content="([^"]*)"\s+property="og:description")/i);
        const ogDescription = ogDescMatch ? (ogDescMatch[1] || ogDescMatch[2]) : null;

        const ogImgMatch = html.match(/<meta\s+(?:property="og:image"\s+content="([^"]*)"|content="([^"]*)"\s+property="og:image")/i);
        const ogImage = ogImgMatch ? (ogImgMatch[1] || ogImgMatch[2]) : null;

        const ogTitleMatch = html.match(/<meta\s+(?:property="og:title"\s+content="([^"]*)"|content="([^"]*)"\s+property="og:title")/i);
        const ogTitle = ogTitleMatch ? (ogTitleMatch[1] || ogTitleMatch[2]) : null;

        // Parse caption from og:description
        // Formats vary: "123 likes, 45 comments - @username: "caption text""
        //               "123 Likes, 45 Comments - @username on Instagram: "caption""
        //               "@username shared a post on Instagram: "caption""
        let caption = '';
        let username = '';
        let likes = 0;
        let comments = 0;

        if (ogDescription) {
            const desc = ogDescription;

            // Extract username first (appears as @username)
            const userMatch = desc.match(/@([\w._]+)/);
            if (userMatch) {
                username = userMatch[1];
            }

            // Strategy 1: Caption in quotes after colon - "username: "caption text""
            let quotedMatch = desc.match(/:\s*["„""«»](.+?)["„""«»]\s*$/);
            if (quotedMatch && quotedMatch[1].length > 0) {
                caption = quotedMatch[1];
            }

            // Strategy 2: Caption after colon without quotes - "username: caption text"
            if (!caption) {
                const colonMatch = desc.match(/@[\w._]+[^:]*:\s*(.+)$/);
                if (colonMatch && colonMatch[1].length > 0) {
                    // Remove trailing quotes if present
                    caption = colonMatch[1].replace(/^["„""«»]|["„""«»]$/g, '').trim();
                }
            }

            // Strategy 3: After " - " separator, take what comes after the username portion
            if (!caption) {
                const dashMatch = desc.match(/\s+-\s+.+?:\s*["„""«»]?(.+?)["„""«»]?\s*$/);
                if (dashMatch && dashMatch[1].length > 0) {
                    caption = dashMatch[1];
                }
            }

            // Strategy 4: If still no caption, try to get everything after the stats part
            if (!caption) {
                // Match: "X likes, Y comments - rest"
                const afterStatsMatch = desc.match(/\d+\s*(?:likes?|mi piace).*?-\s*(.+)$/i);
                if (afterStatsMatch) {
                    // Remove username and colon prefix
                    let text = afterStatsMatch[1];
                    text = text.replace(/^@[\w._]+\s*(?:on Instagram)?:\s*/, '');
                    text = text.replace(/^["„""«»]|["„""«»]$/g, '');
                    if (text.length > 0) {
                        caption = text.trim();
                    }
                }
            }

            // EXTRACT LIKES/COMMENTS FROM META (og:description)
            // Format: "X Likes, Y Comments - @user on Instagram: 'text'"
            // Italian: "X mi piace, Y commenti - @user su Instagram: 'text'"


            if (desc) {
                // English patterns
                const likesMatchEn = desc.match(/([\d.,]+)\s*Likes/i);
                const commentsMatchEn = desc.match(/([\d.,]+)\s*Comments/i);
                // Italian patterns
                const likesMatchIt = desc.match(/([\d.,]+)\s*mi piace/i);
                const commentsMatchIt = desc.match(/([\d.,]+)\s*commenti/i);

                const parseMetaNum = (str) => {
                    if (!str) return 0;
                    // Remove dots/commas used as thousands separators
                    return parseInt(str.replace(/[,.]/g, '')) || 0;
                };

                likes = parseMetaNum(likesMatchEn?.[1] || likesMatchIt?.[1]);
                comments = parseMetaNum(commentsMatchEn?.[1] || commentsMatchIt?.[1]);
            }

            // Strategy 5: Use ogTitle as fallback for username/caption
            if (!caption && ogTitle) {
                // ogTitle format: "@username on Instagram: "caption""
                const titleMatch = ogTitle.match(/:\s*["„""«»]?(.+?)["„""«»]?\s*$/);
                if (titleMatch && titleMatch[1].length > 5) {
                    caption = titleMatch[1];
                }
            }

            console.log('📝 Caption extraction debug:', {
                descLength: desc.length,
                captionFound: caption.length > 0,
                captionPreview: caption.slice(0, 50)
            });
        }

        // Decode HTML entities (including hex &#x2019; and decimal &#39; entities)
        function decodeHtmlEntities(str) {
            if (!str) return '';
            return str
                // Hex entities: &#x2019; -> '
                .replace(/&#x([0-9A-Fa-f]+);?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
                // Decimal entities: &#39; -> '
                .replace(/&#(\d+);?/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
                // Named entities
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&apos;/g, "'")
                .replace(/&nbsp;/g, ' ');
        }
        caption = decodeHtmlEntities(caption);

        const data = {
            caption: caption,
            fullCaption: caption,
            imageUrl: ogImage || null,
            userInfo: username ? {
                username: username,
                displayName: username,
                profileUrl: `https://www.instagram.com/${username}/`
            } : null,
            postType: postUrl.includes('/reel/') ? 'reel' : 'image',
            likes: likes,
            comments: comments,
            timestamp: new Date().toISOString(),
            hashtags: caption.match(/#[\w\u00C0-\u017F]+/gu)?.map(h => h.slice(1)) || [],
            mentions: caption.match(/@[\w._]+/g)?.map(m => m.slice(1)) || []
        };

        console.log('✅ Fetched post data:', { caption: caption.slice(0, 50) + '...' });
        return { success: true, data };

    } catch (error) {
        console.error('❌ Fetch post data error:', error.message);
        // BUG-009 FIX: Extract status code if available (e.g. "HTTP 429")
        const statusMatch = error.message.match(/HTTP (\d+)/);
        return {
            success: false,
            error: error.message,
            statusCode: statusMatch ? parseInt(statusMatch[1]) : null
        };
    }
}

/**
 * Encode una stringa in data: URL base64 (unicode-safe, a chunk per evitare
 * stack overflow). Stessa tecnica usata da exportPosts.
 */
function stringToDataUrl(str, mimeType) {
    const bytes = new TextEncoder().encode(str);
    const CHUNK = 32768;
    let bin = '';
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + CHUNK, bytes.length))));
    }
    return `data:${mimeType};base64,${btoa(bin)}`;
}

/**
 * Driver A: scarica il knowledge base (.md) e il dataset (.json).
 * @returns {Promise<{success:boolean, files?:string[], error?:string}>}
 */
async function downloadIgExtract(filenameBase, markdown, json) {
    try {
        const base = (filenameBase || 'instaghost-extract').replace(/[^\w.-]+/g, '_');
        const files = [];
        if (markdown) {
            await chrome.downloads.download({
                url: stringToDataUrl(markdown, 'text/markdown'),
                filename: `${base}.md`,
                saveAs: false,
            });
            files.push(`${base}.md`);
        }
        if (json) {
            await chrome.downloads.download({
                url: stringToDataUrl(json, 'application/json'),
                filename: `${base}.json`,
                saveAs: false,
            });
            files.push(`${base}.json`);
        }
        console.log('📤 Driver A: scaricati', files.join(', '));
        return { success: true, files };
    } catch (error) {
        console.error('❌ Errore download Driver A:', error);
        return { success: false, error: error.message || 'download_failed' };
    }
}

/**
 * Handle new post found
 * CRIT-001 FIX: Uses atomic upsert pattern - unique constraint is primary duplicate guard
 */
async function handlePostFound(postData) {
    if (!postsDB) {
        console.error('Database non inizializzato');
        return { saved: false, reason: 'db_not_ready' };
    }

    // Validate postData
    if (!postData || !postData.postUrl) {
        console.error('❌ Dati post non validi:', postData);
        return { saved: false, reason: 'invalid_data' };
    }

    // CRIT-002 FIX: Validate URL before saving
    if (!validateInstagramUrl(postData.postUrl)) {
        console.error('❌ Invalid post URL:', postData.postUrl);
        return { saved: false, reason: 'invalid_url' };
    }

    try {
        // CRIT-001 FIX: Atomic insert - rely on unique constraint as PRIMARY duplicate detection
        // The findByUrl check is kept as optimization to avoid transaction overhead,
        // but ConstraintError is the authoritative guard against race conditions
        const existing = await postsDB.posts.findByUrl(postData.postUrl);
        if (existing) {
            console.debug('⏩ Post già esistente:', postData.postUrl);
            return { saved: false, reason: 'duplicate' };
        }

        // Save post - unique index on postUrl will catch any race condition duplicates
        const id = await postsDB.posts.add({
            ...postData,
            savedAt: Date.now()
        });

        console.log('💾 Post salvato:', postData.postUrl);

        // Update badge
        updateBadge();

        return { saved: true, id };

    } catch (error) {
        // CRIT-001: ConstraintError is the AUTHORITATIVE duplicate guard
        // This catches race conditions where two concurrent saves pass the findByUrl check
        if (error.name === 'ConstraintError') {
            console.debug('⏩ Post duplicate caught by constraint:', postData.postUrl);
            return { saved: false, reason: 'duplicate' };
        }

        console.error('❌ Errore salvataggio post:', error);
        // HIGH-004 FIX: Sanitize error message
        return { saved: false, reason: 'save_error' };
    }
}

/**
 * Update extension badge with post count
 */
async function updateBadge() {
    if (!postsDB) return;

    try {
        const count = await postsDB.posts.count();

        if (count > 0) {
            const displayCount = count > 999 ? '999+' : count.toString();
            chrome.action.setBadgeText({ text: displayCount });
            chrome.action.setBadgeBackgroundColor({ color: '#E4405F' }); // Instagram pink
        } else {
            chrome.action.setBadgeText({ text: '' });
        }
    } catch (error) {
        console.error('Errore aggiornamento badge:', error);
    }
}

/**
 * Get statistics
 */
async function getStats() {
    if (!postsDB) return null;

    try {
        return await postsDB.getStats();
    } catch (error) {
        console.error('Errore recupero stats:', error);
        return null;
    }
}

/**
 * Get posts with optional filters
 */
async function getPosts(filter = {}) {
    if (!postsDB) return [];

    try {
        return await postsDB.posts.query({
            ...filter,
            order: 'desc'
        });
    } catch (error) {
        console.error('Errore recupero posts:', error);
        return [];
    }
}

/**
 * Get most recent posts
 */
async function getRecentPosts(limit = 10) {
    if (!postsDB) return [];

    try {
        return await postsDB.posts.query({
            sortBy: 'capturedAt',
            order: 'desc',
            limit
        });
    } catch (error) {
        console.error('Errore recupero post recenti:', error);
        return [];
    }
}

/**
 * Export posts to file
 * @param {string} format - Export format (json, csv, html, markdown, compact)
 * @returns {Promise<{success: boolean, count?: number, error?: string}>}
 */
async function exportPosts(format = 'json') {
    if (!postsDB) {
        console.error('Database non pronto per export');
        return { success: false, error: 'database_not_ready' };
    }

    try {
        const posts = await postsDB.posts.getAll();

        if (posts.length === 0) {
            console.log('Nessun post da esportare');
            return { success: false, error: 'no_posts', count: 0 };
        }

        let dataStr, mimeType, extension;

        switch (format) {
            case 'csv':
                dataStr = convertToCSV(posts);
                mimeType = 'text/csv';
                extension = 'csv';
                break;

            case 'html':
                dataStr = convertToHTML(posts);
                mimeType = 'text/html';
                extension = 'html';
                break;

            case 'markdown':
            case 'md':
            case 'notion':
                dataStr = convertToMarkdown(posts);
                mimeType = 'text/markdown';
                extension = 'md';
                break;

            case 'compact':
                // Compact JSON for sharing - minimal fields
                const compactData = posts.map(p => ({
                    url: p.postUrl,
                    user: p.userInfo?.username || 'unknown',
                    caption: (p.caption || '').slice(0, 200),
                    likes: p.likes || 0,
                    type: p.postType || 'post'
                }));
                dataStr = JSON.stringify(compactData);
                mimeType = 'application/json';
                extension = 'json';
                break;

            default:
                dataStr = JSON.stringify(posts, null, 2);
                mimeType = 'application/json';
                extension = 'json';
        }

        // Use data URL instead of Blob URL (not available in service workers)
        // BUG-004: Unicode-safe base64 encoding with chunking to avoid stack overflow
        const bytes = new TextEncoder().encode(dataStr);

        // Process in chunks to avoid "Maximum call stack size exceeded" error
        const CHUNK_SIZE = 32768; // 32KB chunks
        let binaryStr = '';
        for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
            const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
            binaryStr += String.fromCharCode.apply(null, Array.from(chunk));
        }
        const base64Data = btoa(binaryStr);
        const dataUrl = `data:${mimeType};base64,${base64Data}`;

        const timestamp = new Date().toISOString().slice(0, 10);
        const filename = `instagram_posts_${timestamp}.${extension}`;

        await chrome.downloads.download({
            url: dataUrl,
            filename: filename,
            saveAs: true
        });

        console.log(`📤 Esportati ${posts.length} post in formato ${format}`);
        return { success: true, count: posts.length, format };

    } catch (error) {
        console.error('Errore export:', error);
        return { success: false, error: error.message || 'export_failed' };
    }
}

/**
 * Safely format a date, returning fallback string if invalid
 * @param {*} dateValue - Date value (timestamp, ISO string, or Date object)
 * @param {string} format - 'iso' for ISO string, 'locale' for locale string
 * @returns {string}
 */
function safeFormatDate(dateValue, format = 'iso') {
    if (!dateValue) return 'N/A';
    try {
        const date = new Date(dateValue);
        if (isNaN(date.getTime())) return 'N/A';
        return format === 'locale' ? date.toLocaleString('it-IT') : date.toISOString();
    } catch {
        return 'N/A';
    }
}

/**
 * Convert posts to Markdown format (Notion compatible)
 * @param {Array} posts
 * @returns {string}
 */
function convertToMarkdown(posts) {
    const totalLikes = posts.reduce((s, p) => s + (p.likes || 0), 0);
    const totalComments = posts.reduce((s, p) => s + (p.comments || 0), 0);
    const uniqueUsers = new Set(posts.map(p => p.userInfo?.username || 'unknown')).size;

    let md = `# 📸 Instagram Export\n\n`;
    md += `> **Generated:** ${new Date().toLocaleString('it-IT')}  \n`;
    md += `> **Total Posts:** ${posts.length} | **Likes:** ${totalLikes.toLocaleString()} | **Comments:** ${totalComments.toLocaleString()}  \n`;
    md += `> **Unique Users:** ${uniqueUsers}\n\n`;
    md += `---\n\n`;

    // Group by user
    const byUser = {};
    for (const post of posts) {
        const username = post.userInfo?.username || 'unknown';
        if (!byUser[username]) {
            byUser[username] = [];
        }
        byUser[username].push(post);
    }

    // Generate markdown for each user
    for (const [username, userPosts] of Object.entries(byUser)) {
        md += `## @${escapeHtml(username)}\n\n`;
        md += `**Posts:** ${userPosts.length} | `;
        md += `**Total Likes:** ${userPosts.reduce((s, p) => s + (p.likes || 0), 0).toLocaleString()}\n\n`;

        for (const post of userPosts) {
            md += `### ${post.postType === 'reel' ? '🎬' : post.postType === 'carousel' ? '📚' : '🖼️'} `;
            md += `Post\n\n`;

            // Stats
            md += `- **Type:** ${escapeHtml(post.postType || 'image')}\n`;
            md += `- **Likes:** ${(post.likes || 0).toLocaleString()}\n`;
            md += `- **Comments:** ${(post.comments || 0).toLocaleString()}\n`;
            if (post.viewCount) {
                md += `- **Views:** ${post.viewCount.toLocaleString()}\n`;
            }
            if (post.location) {
                md += `- **Location:** ${escapeHtml(post.location)}\n`;
            }
            md += `- **URL:** [Open on Instagram](${post.postUrl})\n`;
            md += `- **Captured:** ${safeFormatDate(post.capturedAt || post.savedAt, 'locale')}\n\n`;

            // Caption
            if (post.caption) {
                md += `> ${escapeHtml(post.caption.slice(0, 500))}${post.caption.length > 500 ? '...' : ''}\n\n`;
            }

            // Hashtags
            if (post.hashtags && post.hashtags.length > 0) {
                md += `**Hashtags:** ${post.hashtags.map(h => `\`#${h}\``).join(' ')}\n\n`;
            }

            md += `---\n\n`;
        }
    }

    return md;
}

/**
 * Convert posts to CSV format
 */
function convertToCSV(posts) {
    const headers = [
        'Post URL',
        'Username',
        'Caption',
        'Likes',
        'Comments',
        'Type',
        'Hashtags',
        'Location',
        'Image URL',
        'Captured At'
    ];

    const rows = posts.map(post => [
        escapeCSV(post.postUrl || ''),
        escapeCSV(post.userInfo?.username || ''),
        escapeCSV(post.caption || ''),
        post.likes || 0,
        post.comments || 0,
        escapeCSV(post.postType || 'unknown'),
        escapeCSV((post.hashtags || []).join(' ')),
        escapeCSV(post.location || ''),
        escapeCSV(post.imageUrl || ''),
        safeFormatDate(post.capturedAt || post.savedAt, 'iso')
    ]);

    return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

/**
 * Convert posts to HTML format
 */
function convertToHTML(posts) {
    return `
<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https://*.cdninstagram.com https://*.fbcdn.net data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none';">
  <title>Instagram Posts Export</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background: #fafafa;
    }
    h1 { color: #262626; }
    .stats {
      background: linear-gradient(135deg, #833ab4, #fd1d1d, #fcb045);
      color: white;
      padding: 20px;
      border-radius: 12px;
      margin-bottom: 30px;
    }
    .post {
      background: white;
      border: 1px solid #dbdbdb;
      border-radius: 8px;
      margin-bottom: 20px;
      overflow: hidden;
    }
    .post-header {
      padding: 14px;
      border-bottom: 1px solid #efefef;
      font-weight: 600;
    }
    .post-image {
      width: 100%;
      max-height: 500px;
      object-fit: cover;
    }
    .post-content {
      padding: 14px;
    }
    .post-meta {
      color: #8e8e8e;
      font-size: 12px;
    }
    .post-caption {
      margin: 10px 0;
      line-height: 1.5;
    }
    .post-stats {
      display: flex;
      gap: 15px;
      margin-top: 10px;
    }
    a { color: #0095f6; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>📸 Instagram Posts Export</h1>
  
  <div class="stats">
    <strong>Totale post:</strong> ${posts.length} |
    <strong>Totale likes:</strong> ${posts.reduce((s, p) => s + (p.likes || 0), 0).toLocaleString()} |
    <strong>Esportato:</strong> ${new Date().toLocaleString('it-IT')}
  </div>
  
  ${posts.map(post => `
    <div class="post">
      <div class="post-header">
        ${post.userInfo?.username ? `@${escapeHtml(post.userInfo.username)}` : 'Unknown'}
        ${post.location ? ` · ${escapeHtml(post.location)}` : ''}
      </div>
      ${post.imageUrl ? `<img class="post-image" src="${sanitizeUrl(post.imageUrl)}" alt="Post">` : ''}
      <div class="post-content">
        <div class="post-stats">
          <span>❤️ ${(post.likes || 0).toLocaleString()}</span>
          <span>💬 ${(post.comments || 0).toLocaleString()}</span>
          <span>📷 ${escapeHtml(post.postType || 'post')}</span>
        </div>
        <div class="post-caption">${escapeHtml(post.caption || '')}</div>
        <div class="post-meta">
          <a href="${sanitizeUrl(post.postUrl)}" target="_blank" rel="noopener noreferrer">Apri su Instagram</a> ·
          Salvato: ${safeFormatDate(post.capturedAt || post.savedAt, 'locale')}
        </div>
      </div>
    </div>
  `).join('')}
  
</body>
</html>
  `;
}

/**
 * Clear all data
 */
async function clearData() {
    if (!postsDB) return;

    try {
        await postsDB.posts.clear();
        await updateBadge();
        console.log('🗑️ Tutti i dati cancellati');
    } catch (error) {
        console.error('Errore cancellazione dati:', error);
        throw error;
    }
}

/**
 * Record monitoring session
 */
async function recordSession(type, timestamp, stats = null) {
    if (!postsDB) return;

    try {
        await postsDB.sessions.add({
            type,
            timestamp,
            stats
        });
    } catch (error) {
        console.error('Errore registrazione sessione:', error);
    }
}

/**
 * Schedule automatic cleanup of old posts
 */
function scheduleCleanup() {
    // Run cleanup every 24 hours
    setInterval(async () => {
        if (!postsDB) return;

        try {
            // Delete posts older than 30 days
            const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
            const deletedCount = await postsDB.posts.deleteOlderThan(thirtyDaysAgo);

            if (deletedCount > 0) {
                console.log(`🧹 Cleanup: eliminati ${deletedCount} post`);
                updateBadge();
            }
        } catch (error) {
            console.error('Errore cleanup:', error);
        }
    }, 24 * 60 * 60 * 1000); // 24 hours
}

console.log('📸 Instagram Monitor Service Worker caricato');
