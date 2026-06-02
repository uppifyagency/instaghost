/**
 * InstaGhost — Background Service Worker (Era 3 / Driver A).
 *
 * Single role: open the side panel and save to file (.md/.json) the knowledge
 * base produced by the content-script. The Driver A flow (content/ig-driver.js ->
 * IgApiClient) sends three broadcasts:
 *   - ig_download  -> here: we download the files to the Downloads folder
 *   - ig_progress  -> meant for the side panel (no-op here)
 *   - ig_result    -> meant for the side panel (no-op here)
 *
 * HISTORICAL NOTE (cleanup 2026-06-02): the IndexedDB persistence layer
 * (background/db.js) and the legacy DOM-architecture handlers — Era 1/2:
 * post_found, fetch_post_data, export_*, get_*, monitoring_* — have been
 * ARCHIVED in legacy/ because Driver A writes files directly and never
 * touches the database. To restore them see legacy/README.md.
 */

// ===== SIDE PANEL =====

// Open the side panel when the extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
    try {
        await chrome.sidePanel.open({ windowId: tab.windowId });
    } catch (error) {
        console.error('Error opening side panel:', error);
    }
});

// Behavior: open the panel on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch(error => console.error('setPanelBehavior error:', error));


// ===== MESSAGE ROUTER =====

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender, sendResponse);
    return true; // keeps the channel open for the async response
});

async function handleMessage(message, sender, sendResponse) {
    try {
        switch (message.action) {
            case 'ig_download':
                // Driver A: download the knowledge base (Markdown) + dataset (JSON)
                const dlResult = await downloadIgExtract(message.filenameBase, message.markdown, message.json);
                sendResponse(dlResult);
                break;

            case 'ig_download_media':
                // Driver A (optional): download the extraction's photos/videos
                const mediaRes = await downloadMedia(message.handle, message.items);
                sendResponse(mediaRes);
                break;

            case 'ig_progress':
            case 'ig_result':
                // Driver A broadcasts meant for the side panel: no-op here
                sendResponse({ success: true });
                break;

            case 'clear_data':
                // The Driver A architecture does not persist to a DB: the real reset
                // (clearing chrome.storage.local) happens on the UI side in
                // ui/sidepanel.js. We respond ok for compatibility with the button.
                sendResponse({ success: true });
                break;

            default:
                sendResponse({ success: false, error: 'Unknown action' });
        }
    } catch (error) {
        console.error('❌ Message handling error:', error);
        sendResponse({ success: false, error: error.message });
    }
}


// ===== DOWNLOAD (Driver A) =====

/**
 * Encode a string into a base64 data: URL (unicode-safe, chunked to avoid
 * a stack overflow on large inputs).
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
 * Driver A: download the knowledge base (.md) and the dataset (.json).
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
        console.log('📤 Driver A: downloaded', files.join(', '));
        return { success: true, files };
    } catch (error) {
        console.error('❌ Driver A download error:', error);
        return { success: false, error: error.message || 'download_failed' };
    }
}

/**
 * Download an extraction's media (photos/videos): one chrome.downloads per asset.
 * Instagram's CDN URLs are signed → downloadable by the browser. Notifies the
 * side panel with ig_media_progress / ig_media_done.
 * @param {string} handle
 * @param {Array<{url:string, filename:string}>} items
 */
async function downloadMedia(handle, items) {
    const list = Array.isArray(items) ? items : [];
    const total = list.length;
    let ok = 0, failed = 0;
    for (let i = 0; i < list.length; i++) {
        try {
            await chrome.downloads.download({
                url: list[i].url,
                filename: list[i].filename,
                saveAs: false,
                conflictAction: 'uniquify',
            });
            ok++;
        } catch (e) {
            failed++;
        }
        if ((i + 1) % 4 === 0 || i + 1 === total) {
            try { chrome.runtime.sendMessage({ action: 'ig_media_progress', done: i + 1, total }); } catch (_) {}
        }
    }
    try { chrome.runtime.sendMessage({ action: 'ig_media_done', ok, failed, total }); } catch (_) {}
    console.log(`📥 Media: ${ok}/${total} downloaded (failed: ${failed})`);
    return { success: true, ok, failed, total };
}

console.log('📸 InstaGhost Service Worker (Driver A) loaded');
