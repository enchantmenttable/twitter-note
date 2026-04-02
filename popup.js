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

  // Normalize note value (handles old string format and new object format)
  function normalizeNote(raw) {
    if (!raw) return { text: '', screenshots: [] };
    if (typeof raw === 'string') return { text: raw, screenshots: [] };
    return { text: raw.text || '', screenshots: raw.screenshots || [] };
  }

  // Export notes as ZIP
  async function handleExport() {
    try {
      const result = await chrome.storage.local.get('notes');
      const notes = result.notes || {};

      if (Object.keys(notes).length === 0) {
        setStatus('No notes to export', 'error');
        return;
      }

      const zip = new JSZip();
      const screenshotsFolder = zip.folder('screenshots');
      const exportNotes = {};

      for (const [username, raw] of Object.entries(notes)) {
        const note = normalizeNote(raw);
        const screenshotRefs = [];

        note.screenshots.forEach((dataUrl, i) => {
          const filename = `${username}_${i}.jpg`;
          // Extract base64 data from data URL
          const base64 = dataUrl.split(',')[1];
          screenshotsFolder.file(filename, base64, { base64: true });
          screenshotRefs.push(`screenshots/${filename}`);
        });

        exportNotes[username] = {
          text: note.text,
          screenshots: screenshotRefs
        };
      }

      const data = {
        version: 2,
        exportedAt: new Date().toISOString(),
        notes: exportNotes
      };

      zip.file('notes.json', JSON.stringify(data, null, 2));

      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);

      const date = new Date().toISOString().split('T')[0];
      const a = document.createElement('a');
      a.href = url;
      a.download = `twitter-notes-${date}.zip`;
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
      if (file.name.endsWith('.zip')) {
        await handleZipImport(file);
      } else {
        await handleJsonImport(file);
      }
    } catch (e) {
      console.error('Import error:', e);
      setStatus('Error reading file', 'error');
    }

    // Reset file input
    importFile.value = '';
  }

  // Import from JSON (legacy format)
  async function handleJsonImport(file) {
    const text = await file.text();
    const data = JSON.parse(text);

    if (!data.notes || typeof data.notes !== 'object') {
      setStatus('Invalid file format', 'error');
      return;
    }

    // Normalize all notes to new format
    const normalized = {};
    for (const [username, raw] of Object.entries(data.notes)) {
      normalized[username] = normalizeNote(raw);
    }

    await processImport(normalized);
  }

  // Import from ZIP
  async function handleZipImport(file) {
    const zip = await JSZip.loadAsync(file);
    const notesFile = zip.file('notes.json');

    if (!notesFile) {
      setStatus('Invalid ZIP: missing notes.json', 'error');
      return;
    }

    const data = JSON.parse(await notesFile.async('string'));

    if (!data.notes || typeof data.notes !== 'object') {
      setStatus('Invalid file format', 'error');
      return;
    }

    // Rebuild notes with screenshot data URLs from ZIP
    const rebuilt = {};
    for (const [username, raw] of Object.entries(data.notes)) {
      const note = normalizeNote(raw);
      const screenshots = [];

      for (const ref of note.screenshots) {
        const imgFile = zip.file(ref);
        if (imgFile) {
          const base64 = await imgFile.async('base64');
          screenshots.push(`data:image/jpeg;base64,${base64}`);
        }
      }

      rebuilt[username] = { text: note.text, screenshots };
    }

    await processImport(rebuilt);
  }

  // Check if two notes are identical
  function notesEqual(a, b) {
    const na = normalizeNote(a);
    const nb = normalizeNote(b);
    if (na.text !== nb.text) return false;
    if (na.screenshots.length !== nb.screenshots.length) return false;
    return na.screenshots.every((s, i) => s === nb.screenshots[i]);
  }

  // Format note for conflict display
  function formatNotePreview(note) {
    const n = normalizeNote(note);
    let preview = n.text || '(no text)';
    if (n.screenshots.length > 0) {
      preview += `\n\n📎 ${n.screenshots.length} screenshot${n.screenshots.length !== 1 ? 's' : ''}`;
    }
    return preview;
  }

  // Process imported notes (expects normalized { text, screenshots } values)
  async function processImport(importedNotes) {
    const result = await chrome.storage.local.get('notes');
    const currentNotes = result.notes || {};

    // Reset state
    conflicts = [];
    currentConflictIndex = 0;
    resolvedNotes = { ...currentNotes };
    importStats = { added: 0, updated: 0, kept: 0 };

    // Categorize imported notes
    for (const [username, importedNote] of Object.entries(importedNotes)) {
      const currentRaw = currentNotes[username];

      if (!currentRaw) {
        // New note - auto import
        resolvedNotes[username] = importedNote;
        importStats.added++;
      } else if (!notesEqual(currentRaw, importedNote)) {
        // Conflict - needs resolution
        conflicts.push({
          username,
          current: normalizeNote(currentRaw),
          imported: importedNote
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
    currentNoteEl.textContent = formatNotePreview(conflict.current);
    importedNoteEl.textContent = formatNotePreview(conflict.imported);
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
