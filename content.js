// Twitter Note Extension - Content Script

(function () {
    'use strict';

    let currentUsername = null;
    let saveTimeout = null;
    let noteContainer = null;

    // SVG icons
    const NOTE_ICON = `<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 7h10v2H7V7zm0 4h10v2H7v-2zm0 4h7v2H7v-2z"/></svg>`;
    const CLOSE_ICON = `<svg viewBox="0 0 24 24"><path d="M18.3 5.71a.996.996 0 00-1.41 0L12 10.59 7.11 5.7A.996.996 0 105.7 7.11L10.59 12 5.7 16.89a.996.996 0 101.41 1.41L12 13.41l4.89 4.89a.996.996 0 101.41-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4z"/></svg>`;
    const RESIZE_ICON = `<svg viewBox="0 0 24 24"><path d="M22 22H20V20H22V22ZM22 18H20V16H22V18ZM18 22H16V20H18V22ZM22 14H20V12H22V14ZM18 18H16V16H18V18ZM14 22H12V20H14V22Z"/></svg>`;
    const CHEVRON_LEFT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>`;
    const CHEVRON_RIGHT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`;
    const DELETE_ICON = `<svg viewBox="0 0 24 24"><path d="M18.3 5.71a.996.996 0 00-1.41 0L12 10.59 7.11 5.7A.996.996 0 105.7 7.11L10.59 12 5.7 16.89a.996.996 0 101.41 1.41L12 13.41l4.89 4.89a.996.996 0 101.41-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4z"/></svg>`;
    const MAX_SCREENSHOTS = 10;

    // Check if extension context is still valid
    function isContextValid() {
        return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
    }

    // Get username from URL
    function getUsernameFromUrl() {
        const match = window.location.pathname.match(/^\/([^\/]+)/);
        if (match && match[1]) {
            const username = match[1].toLowerCase();
            // Exclude Twitter reserved paths
            const reserved = ['home', 'explore', 'search', 'notifications', 'messages', 'settings', 'i', 'compose', 'intent'];
            if (!reserved.includes(username)) {
                return username;
            }
        }
        return null;
    }

    // Normalize note from storage (handles old string format and new object format)
    function normalizeNote(raw) {
        if (!raw) return { text: '', screenshots: [] };
        if (typeof raw === 'string') return { text: raw, screenshots: [] };
        return { text: raw.text || '', screenshots: raw.screenshots || [] };
    }

    // Load note from storage
    async function loadNote(username) {
        if (!isContextValid()) {
            console.warn('Twitter Note: Extension context invalidated. Please refresh the page.');
            return { text: '', screenshots: [] };
        }
        try {
            const result = await chrome.storage.local.get('notes');
            const notes = result.notes || {};
            return normalizeNote(notes[username]);
        } catch (e) {
            console.error('Twitter Note: Error loading note', e);
            return { text: '', screenshots: [] };
        }
    }

    // Save note to storage
    async function saveNote(username, text, screenshots) {
        if (!isContextValid()) {
            console.error('Twitter Note: Cannot save, context invalidated. Please refresh the page.');
            return false;
        }
        try {
            const result = await chrome.storage.local.get('notes');
            const notes = result.notes || {};
            if (text.trim() || (screenshots && screenshots.length > 0)) {
                notes[username] = { text, screenshots: screenshots || [] };
            } else {
                delete notes[username];
            }
            await chrome.storage.local.set({ notes });
            return true;
        } catch (e) {
            console.error('Twitter Note: Error saving note', e);
            return false;
        }
    }

    // Check if user has a note
    async function hasNote(username) {
        const note = await loadNote(username);
        return note.text.trim().length > 0 || note.screenshots.length > 0;
    }

    // Process clipboard image: resize if needed, convert to JPEG
    async function processClipboardImage(blob) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                let { width, height } = img;
                const maxDim = 1920;
                if (width > maxDim || height > maxDim) {
                    const scale = maxDim / Math.max(width, height);
                    width = Math.round(width * scale);
                    height = Math.round(height * scale);
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error('Failed to load image'));
            };
            img.src = url;
        });
    }

    // Create note button
    function createNoteButton() {
        const button = document.createElement('button');
        button.className = 'twitter-note-btn';
        button.title = 'Add note';
        button.innerHTML = NOTE_ICON;
        return button;
    }

    // Create note panel
    function createNotePanel() {
        const panel = document.createElement('div');
        panel.className = 'twitter-note-panel';
        panel.innerHTML = `
      <div class="twitter-note-header">
        <span class="twitter-note-title">Note <span class="twitter-note-status">— Autosaved</span></span>
        <button class="twitter-note-close">${CLOSE_ICON}</button>
      </div>
      <textarea class="twitter-note-textarea" placeholder="Write a note (you can paste screenshots too)"></textarea>
      <div class="twitter-note-screenshots"></div>
      <div class="twitter-note-resize-handle">${RESIZE_ICON}</div>
    `;
        return panel;
    }

    // Render screenshot thumbnails
    function renderScreenshots(container, screenshots, onDelete, onView) {
        container.innerHTML = '';
        screenshots.forEach((dataUrl, index) => {
            const thumb = document.createElement('div');
            thumb.className = 'twitter-note-thumb';

            const img = document.createElement('img');
            img.src = dataUrl;
            img.addEventListener('click', (e) => {
                e.stopPropagation();
                onView(index);
            });

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'twitter-note-thumb-delete';
            deleteBtn.innerHTML = DELETE_ICON;
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                onDelete(index);
            });

            thumb.appendChild(img);
            thumb.appendChild(deleteBtn);
            container.appendChild(thumb);
        });
    }

    // Open lightbox carousel for screenshots
    function openLightbox(screenshots, startIndex) {
        let currentIndex = startIndex;

        const overlay = document.createElement('div');
        overlay.className = 'twitter-note-lightbox';
        overlay.innerHTML = `
            <div class="twitter-note-lightbox-backdrop"></div>
            <button class="twitter-note-lightbox-close">${CLOSE_ICON}</button>
            <button class="twitter-note-lightbox-prev">${CHEVRON_LEFT}</button>
            <img class="twitter-note-lightbox-img" />
            <button class="twitter-note-lightbox-next">${CHEVRON_RIGHT}</button>
            <span class="twitter-note-lightbox-counter"></span>
        `;

        const img = overlay.querySelector('.twitter-note-lightbox-img');
        const prevBtn = overlay.querySelector('.twitter-note-lightbox-prev');
        const nextBtn = overlay.querySelector('.twitter-note-lightbox-next');
        const counter = overlay.querySelector('.twitter-note-lightbox-counter');
        const closeBtn = overlay.querySelector('.twitter-note-lightbox-close');
        const backdrop = overlay.querySelector('.twitter-note-lightbox-backdrop');

        function update() {
            img.src = screenshots[currentIndex];
            counter.textContent = `${currentIndex + 1} / ${screenshots.length}`;
            prevBtn.style.display = currentIndex > 0 ? '' : 'none';
            nextBtn.style.display = currentIndex < screenshots.length - 1 ? '' : 'none';
        }

        function close() {
            overlay.remove();
            document.removeEventListener('keydown', onKey);
        }

        function onKey(e) {
            if (e.key === 'Escape') close();
            if (e.key === 'ArrowLeft' && currentIndex > 0) { currentIndex--; update(); }
            if (e.key === 'ArrowRight' && currentIndex < screenshots.length - 1) { currentIndex++; update(); }
        }

        closeBtn.addEventListener('click', (e) => { e.stopPropagation(); close(); });
        prevBtn.addEventListener('click', (e) => { e.stopPropagation(); currentIndex--; update(); });
        nextBtn.addEventListener('click', (e) => { e.stopPropagation(); currentIndex++; update(); });
        backdrop.addEventListener('click', (e) => { e.stopPropagation(); close(); });
        overlay.addEventListener('click', (e) => e.stopPropagation());
        document.addEventListener('keydown', onKey);

        update();
        document.body.appendChild(overlay);
    }

    // Position the panel relative to the button (initial position only)
    function positionPanel(panel, button) {
        const rect = button.getBoundingClientRect();
        panel.style.top = (rect.bottom + 8) + 'px';
        panel.style.left = Math.max(10, rect.left - 280) + 'px';
    }

    // Track document-level listeners so we can clean them up when panel closes
    let panelCleanupFns = [];

    function addPanelDocListener(event, fn) {
        document.addEventListener(event, fn);
        panelCleanupFns.push(() => document.removeEventListener(event, fn));
    }

    function cleanupPanelListeners() {
        panelCleanupFns.forEach(fn => fn());
        panelCleanupFns = [];
    }

    // Transparent overlay to capture mouse events during drag/resize
    // Prevents Twitter content (iframes, images) from stealing events
    function createMouseOverlay() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483646;cursor:inherit;';
        document.body.appendChild(overlay);
        return overlay;
    }

    // Make panel draggable via header
    function makeDraggable(panel) {
        const header = panel.querySelector('.twitter-note-header');
        let isDragging = false;
        let overlay = null;
        let offsetX = 0;
        let offsetY = 0;

        header.addEventListener('mousedown', (e) => {
            // Don't drag if clicking close button
            if (e.target.closest('.twitter-note-close')) return;

            isDragging = true;
            overlay = createMouseOverlay();
            overlay.style.cursor = 'grabbing';
            offsetX = e.clientX - panel.offsetLeft;
            offsetY = e.clientY - panel.offsetTop;
            e.preventDefault();
        });

        addPanelDocListener('mousemove', (e) => {
            if (!isDragging) return;

            const newLeft = e.clientX - offsetX;
            const newTop = e.clientY - offsetY;

            // Keep panel within viewport
            panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, newLeft)) + 'px';
            panel.style.top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, newTop)) + 'px';
        });

        addPanelDocListener('mouseup', () => {
            isDragging = false;
            if (overlay) { overlay.remove(); overlay = null; }
        });
    }

    // Make panel resizable via custom handle
    function makeResizable(panel) {
        const handle = panel.querySelector('.twitter-note-resize-handle');
        let isResizing = false;
        let overlay = null;
        let startX = 0;
        let startY = 0;
        let startWidth = 0;
        let startHeight = 0;

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            overlay = createMouseOverlay();
            overlay.style.cursor = 'nwse-resize';
            startX = e.clientX;
            startY = e.clientY;
            startWidth = panel.offsetWidth;
            startHeight = panel.offsetHeight;
            e.preventDefault();
            e.stopPropagation();
        });

        addPanelDocListener('mousemove', (e) => {
            if (!isResizing) return;

            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            // Calculate new dimensions
            const newWidth = Math.max(200, Math.min(600, startWidth + deltaX));
            const newHeight = Math.max(150, startHeight + deltaY);

            panel.style.width = newWidth + 'px';
            panel.style.height = newHeight + 'px';
        });

        addPanelDocListener('mouseup', () => {
            isResizing = false;
            if (overlay) { overlay.remove(); overlay = null; }
        });
    }

    // Toggle note panel
    async function toggleNotePanel(button, username) {
        // Use provided username or fall back to currentUsername (for profile pages)
        const targetUsername = username || currentUsername;

        // Check if panel already exists
        let panel = document.querySelector('.twitter-note-panel');

        // Helper to close panel and clean up listeners
        function closePanel() {
            if (panel && panel.parentNode) {
                panel.remove();
                cleanupPanelListeners();
            }
        }

        if (panel) {
            closePanel();
            return;
        }

        // Open panel
        panel = createNotePanel();
        document.body.appendChild(panel);

        // Position relative to button (initial position only, stays fixed after)
        positionPanel(panel, button);

        // Make draggable and resizable
        makeDraggable(panel);
        makeResizable(panel);

        const textarea = panel.querySelector('.twitter-note-textarea');
        const status = panel.querySelector('.twitter-note-status');
        const closeBtn = panel.querySelector('.twitter-note-close');
        const screenshotsContainer = panel.querySelector('.twitter-note-screenshots');

        // Screenshot state for this panel session
        let screenshots = [];

        // Helper to trigger debounced save of text + screenshots
        function triggerSave() {
            status.textContent = '— Saving...';
            if (saveTimeout) clearTimeout(saveTimeout);
            saveTimeout = setTimeout(async () => {
                if (targetUsername) {
                    const success = await saveNote(targetUsername, textarea.value, screenshots);
                    status.textContent = success ? '— Saved' : '— Error saving';
                    if (textarea.value.trim() || screenshots.length > 0) {
                        button.classList.add('has-note');
                    } else {
                        button.classList.remove('has-note');
                    }
                }
            }, 500);
        }

        // Helper to re-render thumbnails
        function updateThumbnails() {
            renderScreenshots(screenshotsContainer, screenshots, (index) => {
                screenshots.splice(index, 1);
                updateThumbnails();
                triggerSave();
            }, (index) => {
                openLightbox(screenshots, index);
            });
        }

        // Load existing note
        if (targetUsername) {
            const note = await loadNote(targetUsername);
            textarea.value = note.text;
            screenshots = [...note.screenshots];
            status.textContent = (note.text || screenshots.length > 0) ? '— Saved' : '— Autosaved';
            updateThumbnails();
        }

        // Focus textarea
        textarea.focus();

        // Autosave on text input with debounce
        textarea.addEventListener('input', () => {
            triggerSave();
        });

        // Paste handler for screenshots
        panel.addEventListener('paste', async (e) => {
            const items = e.clipboardData?.items;
            if (!items) return;

            for (const item of items) {
                if (item.type.startsWith('image/')) {
                    e.preventDefault();

                    if (screenshots.length >= MAX_SCREENSHOTS) {
                        status.textContent = `— Max ${MAX_SCREENSHOTS} screenshots`;
                        setTimeout(() => {
                            status.textContent = '— Saved';
                        }, 3000);
                        return;
                    }

                    try {
                        const blob = item.getAsFile();
                        const dataUrl = await processClipboardImage(blob);
                        screenshots.push(dataUrl);
                        updateThumbnails();
                        triggerSave();
                    } catch (err) {
                        console.error('Twitter Note: Error processing screenshot', err);
                        status.textContent = '— Error adding screenshot';
                    }
                    return;
                }
            }
        });

        // Close button
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            closePanel();
        });

        // Close on click outside (but not when lightbox is open)
        setTimeout(() => {
            document.addEventListener('click', function closeOnOutside(e) {
                const lightbox = document.querySelector('.twitter-note-lightbox');
                if (lightbox && lightbox.contains(e.target)) return;
                if (!panel.contains(e.target) && !button.contains(e.target)) {
                    closePanel();
                    document.removeEventListener('click', closeOnOutside);
                }
            });
        }, 10);

        // Close on browser back/forward navigation
        const closeOnNavigation = () => {
            closePanel();
            window.removeEventListener('popstate', closeOnNavigation);
        };
        window.addEventListener('popstate', closeOnNavigation);
    }

    // Extract username from block button
    function extractUsernameFromBlock(blockButton) {
        // Try aria-label first
        const label = blockButton.getAttribute('aria-label') || '';
        // Also check inner text in case it's in a span
        const text = blockButton.innerText || '';
        const combined = (label + ' ' + text).trim();

        const match = combined.match(/Block @(\w+)/i);
        return match ? match[1].toLowerCase() : null;
    }

    // Inject note button into tweet dropdown
    let dropdownInjectTimeout = null;
    function injectTweetDropdownButton() {
        // Debounce: wait for dropdown to finish rendering
        if (dropdownInjectTimeout) clearTimeout(dropdownInjectTimeout);
        dropdownInjectTimeout = setTimeout(async () => {
            // Skip if already injected anywhere on the page
            if (document.querySelector('.twitter-note-dropdown-item')) return;

            // Find block button - try specific testid first, fall back to text match
            const blockButton = document.querySelector('[data-testid="block"]') ||
                document.querySelector('[data-testid="blockUser"]') ||
                Array.from(document.querySelectorAll('[role="menuitem"]')).find(el => el.innerText.includes('Block @'));

            if (!blockButton || !blockButton.parentNode) return;

            const username = extractUsernameFromBlock(blockButton);
            if (!username) return;

            // Create dropdown item
            const dropdownItem = document.createElement('div');
            dropdownItem.className = 'twitter-note-dropdown-item';
            dropdownItem.setAttribute('role', 'menuitem');
            dropdownItem.setAttribute('tabindex', '0');

            // Insert after the block button
            blockButton.parentNode.insertBefore(dropdownItem, blockButton.nextSibling);

            // Check if user has a note (async)
            const noteExists = await hasNote(username);

            dropdownItem.innerHTML = `
                ${NOTE_ICON}
                <span class="twitter-note-dropdown-item-text">${noteExists ? 'Edit note' : 'Add note'}</span>
            `;

            // Click handler
            dropdownItem.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleNotePanel(dropdownItem, username);
            });
        }, 100);
    }

    // Inject note button
    async function injectNoteButton() {
        const username = getUsernameFromUrl();
        if (!username) return;

        // Check if already injected
        if (noteContainer && document.contains(noteContainer)) {
            if (currentUsername === username) return;
        }

        // Find the More button
        const moreButton = document.querySelector('[data-testid="userActions"]');
        if (!moreButton) return;

        // Check if already injected for this button
        const parent = moreButton.parentElement;
        if (!parent) return;

        if (parent.querySelector('.twitter-note-btn')) {
            return; // Already injected
        }

        currentUsername = username;

        // Create and inject button
        noteContainer = createNoteButton();
        const button = noteContainer;

        // Check if user has existing note
        if (await hasNote(username)) {
            button.classList.add('has-note');
        }

        // Click handler
        button.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleNotePanel(button);
        });

        // Insert before the More button
        parent.insertBefore(noteContainer, moreButton);
    }

    // Check if on a user list page (blocked or muted)
    function getUserListType() {
        const path = window.location.pathname;
        if (path === '/settings/blocked/all') return 'Blocked';
        if (path === '/settings/muted/all') return 'Unmute';
        return null;
    }

    // Inject note buttons into user list items (blocklist or mutelist)
    function injectUserListButtons() {
        const listType = getUserListType();
        if (!listType) return;

        const userCells = document.querySelectorAll('[data-testid="UserCell"]');

        for (const cell of userCells) {
            // Find the action button (Blocked or Muted)
            const actionButton = cell.querySelector(`button[aria-label="${listType}"]`);
            if (!actionButton) continue;

            // Skip if already injected
            if (cell.querySelector('.twitter-note-btn-wrapper')) continue;

            const buttonParent = actionButton.parentElement;

            // Find username from the profile link
            const profileLink = cell.querySelector('a[href^="/"]');
            if (!profileLink) continue;

            const href = profileLink.getAttribute('href');
            const username = href.replace('/', '').toLowerCase();
            if (!username) continue;

            // Create note button
            const noteButton = createNoteButton();

            // Click handler - pass username explicitly
            noteButton.addEventListener('click', (e) => {
                e.stopPropagation();
                toggleNotePanel(noteButton, username);
            });

            // Create wrapper to hold both buttons together (avoids parent flex gap)
            const wrapper = document.createElement('div');
            wrapper.className = 'twitter-note-btn-wrapper';

            // Replace action button with wrapper containing both buttons
            buttonParent.insertBefore(wrapper, actionButton);
            wrapper.appendChild(noteButton);
            wrapper.appendChild(actionButton);

            // Check if user has existing note (async, update style after)
            hasNote(username).then(has => {
                if (has) noteButton.classList.add('has-note');
            });
        }
    }

    // Observe DOM changes for SPA navigation
    function observeDOM() {
        const observer = new MutationObserver(() => {
            // Debounce check
            requestAnimationFrame(() => {
                injectNoteButton();
                injectUserListButtons();
                injectTweetDropdownButton();
            });
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });
    }

    // Initialize
    function init() {
        // Initial injection attempt
        injectNoteButton();
        injectUserListButtons();
        injectTweetDropdownButton();

        // Watch for SPA navigation
        observeDOM();

        // Also handle URL changes
        let lastUrl = location.href;
        new MutationObserver(() => {
            if (location.href !== lastUrl) {
                lastUrl = location.href;
                // Remove existing container
                if (noteContainer) {
                    noteContainer.remove();
                    noteContainer = null;
                }
                // Wait a bit for page to load
                setTimeout(injectNoteButton, 500);
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

    // Start when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
