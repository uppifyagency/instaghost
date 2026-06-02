/**
 * Instagram Monitor - IndexedDB Database Layer
 * Persistent storage for monitored posts
 */

const DB_NAME = 'InstagramMonitorDB';
const DB_VERSION = 1;

let db = null;

/**
 * Initialize the IndexedDB database
 * @returns {Promise<Object>} Database wrapper object
 */
async function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error('❌ Database error:', event.target.error);
            reject(event.target.error);
        };

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            // Create posts object store
            if (!database.objectStoreNames.contains('posts')) {
                const postsStore = database.createObjectStore('posts', {
                    keyPath: 'id',
                    autoIncrement: true
                });

                // Create indexes for efficient queries
                postsStore.createIndex('postUrl', 'postUrl', { unique: true });
                postsStore.createIndex('capturedAt', 'capturedAt');
                postsStore.createIndex('likes', 'likes');
                postsStore.createIndex('postType', 'postType');
                postsStore.createIndex('username', 'userInfo.username');

                console.log('📦 Posts store creato');
            }

            // Create sessions store for tracking
            if (!database.objectStoreNames.contains('sessions')) {
                const sessionsStore = database.createObjectStore('sessions', {
                    keyPath: 'id',
                    autoIncrement: true
                });

                sessionsStore.createIndex('startTime', 'startTime');
                console.log('📦 Sessions store creato');
            }
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            console.log('✅ Database inizializzato');

            // Create wrapper API
            const wrapper = createDBWrapper(db);
            resolve(wrapper);
        };
    });
}

/**
 * Create a Dexie-like wrapper for IndexedDB operations
 * @param {IDBDatabase} database 
 * @returns {Object}
 */
function createDBWrapper(database) {

    /**
     * Validate and sanitize post data to prevent prototype pollution and invalid data
     * @param {Object} post - Post data to validate
     * @returns {Object} Sanitized post object
     * @throws {Error} If validation fails
     */
    function validateAndSanitizePost(post) {
        if (!post || typeof post !== 'object') {
            throw new Error('Invalid post data: must be an object');
        }

        // Prevent prototype pollution - remove dangerous properties
        const dangerousKeys = ['__proto__', 'constructor', 'prototype'];
        const sanitized = {};

        for (const key of Object.keys(post)) {
            if (dangerousKeys.includes(key)) {
                console.warn(`🚨 Blocked dangerous property: ${key}`);
                continue;
            }
            // Only copy own properties, not inherited ones
            if (Object.prototype.hasOwnProperty.call(post, key)) {
                const value = post[key];
                // Recursively sanitize nested objects
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    sanitized[key] = validateAndSanitizePost(value);
                } else {
                    sanitized[key] = value;
                }
            }
        }

        // Validate required fields
        if (sanitized.postUrl && typeof sanitized.postUrl === 'string') {
            // Validate URL format
            try {
                const url = new URL(sanitized.postUrl);
                if (url.protocol !== 'https:' || !url.hostname.includes('instagram.com')) {
                    throw new Error('Invalid post URL: must be Instagram HTTPS URL');
                }
            } catch (e) {
                if (e.message.includes('Invalid post URL')) throw e;
                throw new Error('Invalid post URL format');
            }
        }

        // Validate and sanitize string fields - limit lengths to prevent storage attacks
        const stringLimits = {
            postUrl: 500,
            caption: 5000,
            location: 200,
            imageUrl: 1000,
            videoUrl: 1000,
            postType: 50
        };

        for (const [field, limit] of Object.entries(stringLimits)) {
            if (sanitized[field] && typeof sanitized[field] === 'string') {
                sanitized[field] = sanitized[field].slice(0, limit);
            }
        }

        // Validate numeric fields
        if (sanitized.likes !== undefined) {
            sanitized.likes = Math.max(0, parseInt(sanitized.likes) || 0);
        }
        if (sanitized.comments !== undefined) {
            sanitized.comments = Math.max(0, parseInt(sanitized.comments) || 0);
        }

        // Validate arrays
        if (sanitized.hashtags && Array.isArray(sanitized.hashtags)) {
            sanitized.hashtags = sanitized.hashtags
                .filter(h => typeof h === 'string')
                .slice(0, 100)
                .map(h => h.slice(0, 100));
        }
        if (sanitized.mentions && Array.isArray(sanitized.mentions)) {
            sanitized.mentions = sanitized.mentions
                .filter(m => typeof m === 'string')
                .slice(0, 100)
                .map(m => m.slice(0, 100));
        }

        return sanitized;
    }

    /**
     * Generate a cryptographically secure unique ID
     * @returns {string}
     */
    function generateSecureId() {
        // Use crypto.randomUUID if available, otherwise fallback
        if (typeof crypto !== 'undefined' && crypto.randomUUID) {
            return crypto.randomUUID();
        }
        // Fallback for older environments
        return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}-${Math.random().toString(36).slice(2, 11)}`;
    }

    // Define the wrapper object first
    const wrapper = {
        posts: {
            /**
             * Add a new post
             */
            add: (post) => {
                return new Promise((resolve, reject) => {
                    try {
                        // Validate and sanitize input
                        const sanitizedPost = validateAndSanitizePost(post);

                        const transaction = database.transaction(['posts'], 'readwrite');
                        const store = transaction.objectStore('posts');

                        const postWithId = {
                            ...sanitizedPost,
                            id: generateSecureId()
                        };

                        const request = store.add(postWithId);
                        request.onsuccess = () => resolve(postWithId.id);
                        request.onerror = () => reject(request.error);
                    } catch (validationError) {
                        reject(validationError);
                    }
                });
            },

            /**
             * Get a post by ID
             */
            get: (id) => {
                return new Promise((resolve, reject) => {
                    const transaction = database.transaction(['posts'], 'readonly');
                    const store = transaction.objectStore('posts');
                    const request = store.get(id);

                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
            },

            /**
             * Find post by URL
             */
            findByUrl: (url) => {
                return new Promise((resolve, reject) => {
                    const transaction = database.transaction(['posts'], 'readonly');
                    const store = transaction.objectStore('posts');
                    const index = store.index('postUrl');
                    const request = index.get(url);

                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
            },

            /**
             * Get all posts
             */
            getAll: () => {
                return new Promise((resolve, reject) => {
                    const transaction = database.transaction(['posts'], 'readonly');
                    const store = transaction.objectStore('posts');
                    const request = store.getAll();

                    request.onsuccess = () => resolve(request.result || []);
                    request.onerror = () => reject(request.error);
                });
            },

            /**
             * Get posts with filters
             */
            query: (options = {}) => {
                return new Promise((resolve, reject) => {
                    const transaction = database.transaction(['posts'], 'readonly');
                    const store = transaction.objectStore('posts');

                    let request;

                    if (options.sortBy && store.indexNames.contains(options.sortBy)) {
                        const index = store.index(options.sortBy);
                        request = index.getAll();
                    } else {
                        request = store.getAll();
                    }

                    request.onsuccess = () => {
                        let results = request.result || [];

                        // Apply filters
                        if (options.postType) {
                            results = results.filter(p => p.postType === options.postType);
                        }
                        if (options.minLikes) {
                            results = results.filter(p => (p.likes || 0) >= options.minLikes);
                        }
                        if (options.since) {
                            results = results.filter(p => p.capturedAt >= options.since);
                        }
                        if (options.username) {
                            results = results.filter(p =>
                                p.userInfo?.username?.toLowerCase().includes(options.username.toLowerCase())
                            );
                        }

                        // Sort by capturedAt descending by default
                        results.sort((a, b) => (b.capturedAt || 0) - (a.capturedAt || 0));

                        // LOW-001 FIX: Apply maximum limit to prevent memory issues
                        const MAX_QUERY_LIMIT = 1000;
                        const limit = Math.min(options.limit || MAX_QUERY_LIMIT, MAX_QUERY_LIMIT);
                        results = results.slice(0, limit);

                        resolve(results);
                    };

                    request.onerror = () => reject(request.error);
                });
            },

            /**
             * Count total posts
             */
            count: () => {
                return new Promise((resolve, reject) => {
                    const transaction = database.transaction(['posts'], 'readonly');
                    const store = transaction.objectStore('posts');
                    const request = store.count();

                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
            },

            /**
             * Delete a post by ID
             */
            delete: (id) => {
                return new Promise((resolve, reject) => {
                    const transaction = database.transaction(['posts'], 'readwrite');
                    const store = transaction.objectStore('posts');
                    const request = store.delete(id);

                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
            },

            /**
             * Clear all posts
             */
            clear: () => {
                return new Promise((resolve, reject) => {
                    const transaction = database.transaction(['posts'], 'readwrite');
                    const store = transaction.objectStore('posts');
                    const request = store.clear();

                    request.onsuccess = () => resolve();
                    request.onerror = () => reject(request.error);
                });
            },

            /**
             * Delete posts older than specified timestamp
             */
            deleteOlderThan: (timestamp) => {
                return new Promise((resolve, reject) => {
                    const transaction = database.transaction(['posts'], 'readwrite');
                    const store = transaction.objectStore('posts');
                    const index = store.index('capturedAt');
                    const range = IDBKeyRange.upperBound(timestamp);

                    let deleteCount = 0;
                    const request = index.openCursor(range);

                    request.onsuccess = (event) => {
                        const cursor = event.target.result;
                        if (cursor) {
                            cursor.delete();
                            deleteCount++;
                            cursor.continue();
                        } else {
                            console.log(`🗑️ Eliminati ${deleteCount} post vecchi`);
                            resolve(deleteCount);
                        }
                    };

                    request.onerror = () => reject(request.error);
                });
            }
        },

        sessions: {
            /**
             * Add a new session
             */
            add: (session) => {
                return new Promise((resolve, reject) => {
                    const transaction = database.transaction(['sessions'], 'readwrite');
                    const store = transaction.objectStore('sessions');
                    const request = store.add(session);

                    request.onsuccess = () => resolve(request.result);
                    request.onerror = () => reject(request.error);
                });
            },

            /**
             * Get all sessions
             */
            getAll: () => {
                return new Promise((resolve, reject) => {
                    const transaction = database.transaction(['sessions'], 'readonly');
                    const store = transaction.objectStore('sessions');
                    const request = store.getAll();

                    request.onsuccess = () => resolve(request.result || []);
                    request.onerror = () => reject(request.error);
                });
            }
        },

        /**
         * Get database statistics
         */
        getStats: async function () {
            const posts = await wrapper.posts.getAll();
            const today = new Date().setHours(0, 0, 0, 0);

            const todayPosts = posts.filter(p => p.capturedAt >= today);
            const totalLikes = posts.reduce((sum, p) => sum + (p.likes || 0), 0);
            const totalComments = posts.reduce((sum, p) => sum + (p.comments || 0), 0);

            const typeBreakdown = {
                image: posts.filter(p => p.postType === 'image').length,
                reel: posts.filter(p => p.postType === 'reel').length,
                carousel: posts.filter(p => p.postType === 'carousel').length,
                unknown: posts.filter(p => p.postType === 'unknown').length
            };

            return {
                totalPosts: posts.length,
                todayPosts: todayPosts.length,
                totalLikes,
                totalComments,
                avgLikes: posts.length > 0 ? Math.round(totalLikes / posts.length) : 0,
                avgComments: posts.length > 0 ? Math.round(totalComments / posts.length) : 0,
                typeBreakdown
            };
        }
    };

    return wrapper;
}

// Export for service worker
self.initDB = initDB;
