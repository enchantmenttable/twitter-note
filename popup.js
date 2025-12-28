// Twitter Notes Popup - Export/Import functionality

(function () {
  'use strict';

  // State
  let conflicts = [];
  let currentConflictIndex = 0;
  let resolvedNotes = {};
  let importStats = { added: 0, updated: 0, kept: 0 };

  // DOM elements
  const mainView = document.getElementById('main-view');
  const conflictView = document.getElementById('conflict-view');
  const summaryView = document.getElementById('summary-view');

  const noteCountEl = document.getElementById('note-count');
  const statusEl = document.getElementById('status');
  const exportBtn = document.getElementById('export-btn');
  const importBtn = document.getElementById('import-btn');
  const importFile = document.getElementById('import-file');

  const conflictTitle = document.getElementById('conflict-title');
  const conflictUsername = document.getElementById('conflict-username');
  const currentNoteEl = document.getElementById('current-note');
  const importedNoteEl = document.getElementById('imported-note');
  const keepCurrentBtn = document.getElementById('keep-current-btn');
  const useImportedBtn = document.getElementById('use-imported-btn');
  const keepAllCurrentBtn = document.getElementById('keep-all-current-btn');
  const useAllImportedBtn = document.getElementById('use-all-imported-btn');

  const summaryText = document.getElementById('summary-text');

  // Initialize
  async function init() {
    await updateNoteCount();
    setupEventListeners();
  }

  // Update note count display
  async function updateNoteCount() {
    try {
      const result = await chrome.storage.local.get('notes');
      const notes = result.notes || {};
      const count = Object.keys(notes).length;
      noteCountEl.textContent = `${count} note${count !== 1 ? 's' : ''} saved`;
    } catch (e) {
      noteCountEl.textContent = 'Error loading notes';
    }
  }

  // Setup event listeners
  function setupEventListeners() {
    exportBtn.addEventListener('click', handleExport);
    importBtn.addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', handleImportFile);

    keepCurrentBtn.addEventListener('click', () => resolveConflict('keep'));
    useImportedBtn.addEventListener('click', () => resolveConflict('use'));
    keepAllCurrentBtn.addEventListener('click', () => resolveAllConflicts('keep'));
    useAllImportedBtn.addEventListener('click', () => resolveAllConflicts('use'));
  }

  // Show a specific view
  function showView(view) {
    mainView.classList.add('hidden');
    conflictView.classList.add('hidden');
    summaryView.classList.add('hidden');

    if (view === 'main') {
      mainView.classList.remove('hidden');
      updateNoteCount();
    } else if (view === 'conflict') {
      conflictView.classList.remove('hidden');
    } else if (view === 'summary') {
      summaryView.classList.remove('hidden');
    }
  }

  // Set status message
  function setStatus(message, type = '') {
    statusEl.textContent = message;
    statusEl.className = 'status' + (type ? ` ${type}` : '');
  }

  // Export notes
  async function handleExport() {
    try {
      const result = await chrome.storage.local.get('notes');
      const notes = result.notes || {};

      if (Object.keys(notes).length === 0) {
        setStatus('No notes to export', 'error');
        return;
      }

      const data = {
        version: 1,
        exportedAt: new Date().toISOString(),
        notes: notes
      };

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);

      const date = new Date().toISOString().split('T')[0];
      const filename = `twitter-notes-${date}.json`;

      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();

      URL.revokeObjectURL(url);
      setStatus('Notes exported successfully', 'success');
    } catch (e) {
      console.error('Export error:', e);
      setStatus('Error exporting notes', 'error');
    }
  }

  // Handle import file selection
  async function handleImportFile(e) {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      // Validate structure
      if (!data.notes || typeof data.notes !== 'object') {
        setStatus('Invalid file format', 'error');
        return;
      }

      await processImport(data.notes);
    } catch (e) {
      console.error('Import error:', e);
      setStatus('Error reading file', 'error');
    }

    // Reset file input
    importFile.value = '';
  }

  // Process imported notes
  async function processImport(importedNotes) {
    const result = await chrome.storage.local.get('notes');
    const currentNotes = result.notes || {};

    // Reset state
    conflicts = [];
    currentConflictIndex = 0;
    resolvedNotes = { ...currentNotes };
    importStats = { added: 0, updated: 0, kept: 0 };

    // Categorize imported notes
    for (const [username, importedContent] of Object.entries(importedNotes)) {
      const currentContent = currentNotes[username];

      if (!currentContent) {
        // New note - auto import
        resolvedNotes[username] = importedContent;
        importStats.added++;
      } else if (currentContent !== importedContent) {
        // Conflict - needs resolution
        conflicts.push({
          username,
          current: currentContent,
          imported: importedContent
        });
      }
      // If content is identical, skip silently
    }

    if (conflicts.length > 0) {
      // Show conflict resolution
      showConflict();
      showView('conflict');
    } else {
      // No conflicts - save and show summary
      await saveAndShowSummary();
    }
  }

  // Show current conflict
  function showConflict() {
    const conflict = conflicts[currentConflictIndex];
    conflictTitle.textContent = `Conflict ${currentConflictIndex + 1} of ${conflicts.length}`;
    conflictUsername.textContent = `@${conflict.username}`;
    currentNoteEl.textContent = conflict.current;
    importedNoteEl.textContent = conflict.imported;
  }

  // Resolve single conflict
  function resolveConflict(choice) {
    const conflict = conflicts[currentConflictIndex];

    if (choice === 'use') {
      resolvedNotes[conflict.username] = conflict.imported;
      importStats.updated++;
    } else {
      importStats.kept++;
    }

    currentConflictIndex++;

    if (currentConflictIndex < conflicts.length) {
      showConflict();
    } else {
      saveAndShowSummary();
    }
  }

  // Resolve all remaining conflicts
  function resolveAllConflicts(choice) {
    for (let i = currentConflictIndex; i < conflicts.length; i++) {
      const conflict = conflicts[i];
      if (choice === 'use') {
        resolvedNotes[conflict.username] = conflict.imported;
        importStats.updated++;
      } else {
        importStats.kept++;
      }
    }

    saveAndShowSummary();
  }

  // Save resolved notes and show summary
  async function saveAndShowSummary() {
    try {
      await chrome.storage.local.set({ notes: resolvedNotes });

      const parts = [];
      if (importStats.added > 0) {
        parts.push(`${importStats.added} new note${importStats.added !== 1 ? 's' : ''} added`);
      }
      if (importStats.updated > 0) {
        parts.push(`${importStats.updated} note${importStats.updated !== 1 ? 's' : ''} updated`);
      }
      if (importStats.kept > 0) {
        parts.push(`${importStats.kept} note${importStats.kept !== 1 ? 's' : ''} kept`);
      }

      summaryText.textContent = parts.length > 0 ? parts.join('\n') : 'No changes made';
      showView('summary');
    } catch (e) {
      console.error('Save error:', e);
      setStatus('Error saving notes', 'error');
      showView('main');
    }
  }

  // Initialize when DOM is ready
  document.addEventListener('DOMContentLoaded', init);
})();
