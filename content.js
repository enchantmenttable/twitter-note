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

    // Load note from storage
    async function loadNote(username) {
        try {
            const result = await chrome.storage.local.get('notes');
            const notes = result.notes || {};
            return notes[username] || '';
        } catch (e) {
            console.error('Twitter Note: Error loading note', e);
            return '';
        }
    }

    // Save note to storage
    async function saveNote(username, content) {
        try {
            const result = await chrome.storage.local.get('notes');
            const notes = result.notes || {};
            if (content.trim()) {
                notes[username] = content;
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
        return note.trim().length > 0;
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
      <textarea class="twitter-note-textarea" placeholder="Write a note about this user..."></textarea>
      <div class="twitter-note-resize-handle">${RESIZE_ICON}</div>
    `;
        return panel;
    }

    // Position the panel relative to the button (initial position only)
    function positionPanel(panel, button) {
        const rect = button.getBoundingClientRect();
        panel.style.top = (rect.bottom + 8) + 'px';
        panel.style.left = Math.max(10, rect.left - 280) + 'px';
    }

    // Make panel draggable via header
    function makeDraggable(panel) {
        const header = panel.querySelector('.twitter-note-header');
        let isDragging = false;
        let offsetX = 0;
        let offsetY = 0;

        header.addEventListener('mousedown', (e) => {
            // Don't drag if clicking close button
            if (e.target.closest('.twitter-note-close')) return;

            isDragging = true;
            offsetX = e.clientX - panel.offsetLeft;
            offsetY = e.clientY - panel.offsetTop;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isDragging) return;

            const newLeft = e.clientX - offsetX;
            const newTop = e.clientY - offsetY;

            // Keep panel within viewport
            panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, newLeft)) + 'px';
            panel.style.top = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, newTop)) + 'px';
        });

        document.addEventListener('mouseup', () => {
            isDragging = false;
        });
    }

    // Make panel resizable via custom handle
    function makeResizable(panel) {
        const handle = panel.querySelector('.twitter-note-resize-handle');
        let isResizing = false;
        let startX = 0;
        let startY = 0;
        let startWidth = 0;
        let startHeight = 0;

        handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            startX = e.clientX;
            startY = e.clientY;
            startWidth = panel.offsetWidth;
            startHeight = panel.offsetHeight;
            e.preventDefault();
            e.stopPropagation();
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;

            const deltaX = e.clientX - startX;
            const deltaY = e.clientY - startY;

            // Calculate new dimensions
            const newWidth = Math.max(200, Math.min(600, startWidth + deltaX));
            const newHeight = Math.max(150, startHeight + deltaY);

            panel.style.width = newWidth + 'px';
            panel.style.height = newHeight + 'px';
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
        });
    }

    // Toggle note panel
    async function toggleNotePanel(button, username) {
        // Use provided username or fall back to currentUsername (for profile pages)
        const targetUsername = username || currentUsername;

        // Check if panel already exists
        let panel = document.querySelector('.twitter-note-panel');

        if (panel) {
            // Close panel
            panel.remove();
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

        // Load existing note
        if (targetUsername) {
            textarea.value = await loadNote(targetUsername);
            status.textContent = textarea.value ? '— Saved' : '— Autosaved';
        }

        // Focus textarea
        textarea.focus();

        // Autosave on input with debounce
        textarea.addEventListener('input', () => {
            status.textContent = '— Saving...';

            if (saveTimeout) {
                clearTimeout(saveTimeout);
            }

            saveTimeout = setTimeout(async () => {
                if (targetUsername) {
                    const success = await saveNote(targetUsername, textarea.value);
                    status.textContent = success ? '— Saved' : '— Error saving';

                    // Update button style based on note content
                    if (textarea.value.trim()) {
                        button.classList.add('has-note');
                    } else {
                        button.classList.remove('has-note');
                    }
                }
            }, 500);
        });

        // Close button
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            panel.remove();
        });

        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', function closeOnOutside(e) {
                if (!panel.contains(e.target) && !button.contains(e.target)) {
                    panel.remove();
                    document.removeEventListener('click', closeOnOutside);
                }
            });
        }, 10);

        // Close on browser back/forward navigation
        const closeOnNavigation = () => {
            panel.remove();
            window.removeEventListener('popstate', closeOnNavigation);
        };
        window.addEventListener('popstate', closeOnNavigation);
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
