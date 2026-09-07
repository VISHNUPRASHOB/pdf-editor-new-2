// Application State
let currentSessionId = null;
let currentPdfDoc = null;
let currentPageNum = 1;
let totalPages = 1;
let currentScale = 1.25;
let currentPrecisionMode = 'lines'; // 'lines' or 'words'
let isEditMode = true; // Toggle for in-place direct editing
let showOutlines = true;
let isAddTextMode = false;
let currentPageData = null;

// Active In-line Editing State
let activeInlineEditor = null; // { boxElement, inputElement, itemData, pageIndex, origText, origFontSize, origFont, origColor }

// DOM Elements
const fileUpload = document.getElementById('file-upload');
const dropZone = document.getElementById('drop-zone');
const emptyState = document.getElementById('empty-state');
const viewerWrapper = document.getElementById('viewer-wrapper');
const pdfCanvas = document.getElementById('pdf-canvas');
const textOverlay = document.getElementById('text-overlay');
const pdfContainer = document.getElementById('pdf-container');
const workspace = document.getElementById('workspace');

// Toggles & Toolbars
const editorToggles = document.getElementById('editor-toggles');
const toggleEditModeBtn = document.getElementById('toggle-edit-mode');
const editModeBtnLabel = document.getElementById('edit-mode-btn-label');
const toggleHighlightsBtn = document.getElementById('toggle-highlights');
const modeLinesBtn = document.getElementById('mode-lines');
const modeWordsBtn = document.getElementById('mode-words');
const btnImageTextMode = document.getElementById('btn-image-text-mode');
const btnAddTextMode = document.getElementById('btn-add-text-mode');
const imageDragMarquee = document.getElementById('image-drag-marquee');

let isImageTextMode = false;
let isImageDragging = false;
let imageDragStartX = 0;
let imageDragStartY = 0;

// In-line Floating Toolbar
const inlineToolbar = document.getElementById('inline-toolbar');
const inlineFontSelect = document.getElementById('inline-font-select');
const inlineFontDecrease = document.getElementById('inline-font-decrease');
const inlineFontIncrease = document.getElementById('inline-font-increase');
const inlineFontSizeVal = document.getElementById('inline-font-size-val');
const inlineColorPicker = document.getElementById('inline-color-picker');
const inlineBgPicker = document.getElementById('inline-bg-picker');
const inlineSaveBtn = document.getElementById('inline-save-btn');
const inlineCancelBtn = document.getElementById('inline-cancel-btn');


// Selection Action Badge
const selectionBadge = document.getElementById('selection-badge');
const btnEditSelection = document.getElementById('btn-edit-selection');
let currentSelectedTarget = null;


// Navigation & Zoom
const pageControls = document.getElementById('page-controls');
const zoomControls = document.getElementById('zoom-controls');
const currentPageNumSpan = document.getElementById('current-page-num');
const totalPagesSpan = document.getElementById('total-pages');
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const zoomInBtn = document.getElementById('zoom-in');
const zoomOutBtn = document.getElementById('zoom-out');
const zoomLevelSpan = document.getElementById('zoom-level');
const downloadBtn = document.getElementById('download-btn');

// Toast Notification
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');

function showToast(msg, duration = 2500) {
    toastMessage.textContent = msg;
    toast.style.display = 'flex';
    if (duration > 0) {
        setTimeout(() => {
            toast.style.display = 'none';
        }, duration);
    }
}

function hideToast() {
    toast.style.display = 'none';
}

// File Upload
fileUpload.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
        uploadFile(e.target.files[0]);
    }
});

// Drag & Drop
['dragenter', 'dragover'].forEach(name => {
    dropZone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.add('dragover');
    });
});

['dragleave', 'drop'].forEach(name => {
    dropZone.addEventListener(name, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.classList.remove('dragover');
    });
});

dropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    if (files.length > 0 && files[0].type === 'application/pdf') {
        uploadFile(files[0]);
    } else {
        alert('Please drop a valid PDF document.');
    }
});

async function safeJsonFetch(url, options = {}) {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';
    let data = null;

    if (contentType.includes('application/json')) {
        try {
            data = await response.json();
        } catch (e) {
            data = null;
        }
    } else {
        const text = await response.text();
        if (!response.ok) {
            // Strip HTML tags for clean error message
            const cleanText = text.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
            throw new Error(`Server error (${response.status}): ${cleanText.substring(0, 120) || response.statusText}`);
        }
    }

    if (!response.ok) {
        throw new Error((data && data.error) ? data.error : `Server error (${response.status})`);
    }

    return data;
}

async function uploadFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    showToast('Uploading & processing document...', 0);

    try {
        const fileBufferPromise = file.arrayBuffer();

        const data = await safeJsonFetch('/upload', {
            method: 'POST',
            body: formData
        });

        if (!data || !data.session_id) {
            throw new Error('Invalid response received from server.');
        }

        currentSessionId = data.session_id;
        totalPages = data.page_count;
        currentPageNum = 1;

        emptyState.style.display = 'none';
        viewerWrapper.style.display = 'flex';
        pageControls.style.display = 'flex';
        zoomControls.style.display = 'flex';
        editorToggles.style.display = 'flex';
        downloadBtn.disabled = false;

        totalPagesSpan.textContent = totalPages;
        currentPageNumSpan.textContent = currentPageNum;

        // Load document directly from local memory buffer for instant rendering
        showToast('Rendering page...', 0);
        closeActiveInlineEditor(false);
        const buffer = await fileBufferPromise;
        const loadingTask = pdfjsLib.getDocument({ data: buffer });
        currentPdfDoc = await loadingTask.promise;
        await renderPage(currentPageNum);
        hideToast();
        showToast('Ready! Select or click any text to edit in-place.', 3000);
    } catch (err) {
        hideToast();
        alert('Upload failed: ' + err.message);
    }
}

async function loadPdfViewer() {
    closeActiveInlineEditor(false);
    showToast('Rendering page...', 0);
    const pdfUrl = `/pdf/${currentSessionId}?t=${new Date().getTime()}`;
    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    currentPdfDoc = await loadingTask.promise;
    await renderPage(currentPageNum);
    hideToast();
}

async function renderPage(num) {
    if (!currentPdfDoc) return;
    closeActiveInlineEditor(false);

    currentPageNumSpan.textContent = num;
    prevPageBtn.disabled = (num <= 1);
    nextPageBtn.disabled = (num >= totalPages);

    const page = await currentPdfDoc.getPage(num);
    const viewport = page.getViewport({ scale: currentScale });

    const canvas = pdfCanvas;
    const ctx = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    pdfContainer.style.width = `${viewport.width}px`;
    pdfContainer.style.height = `${viewport.height}px`;

    const renderContext = {
        canvasContext: ctx,
        viewport: viewport
    };

    await page.render(renderContext).promise;
    await loadTextBlocks(num - 1, viewport);
}

// Load and position selectable interactive text elements
async function loadTextBlocks(pageIndex, viewport) {
    textOverlay.innerHTML = '';
    hideSelectionBadge();

    try {
        const data = await safeJsonFetch(`/text-blocks/${currentSessionId}/${pageIndex}`);
        if (!data) return;

        currentPageData = data;

        const docWidth = data.page_width;
        const docHeight = data.page_height;
        const pageX0 = data.page_x0 || 0;
        const pageY0 = data.page_y0 || 0;

        const scaleX = viewport.width / docWidth;
        const scaleY = viewport.height / docHeight;

        let itemsToRender = [];
        if (currentPrecisionMode === 'words') {
            if (data.words && data.words.length > 0) {
                itemsToRender = data.words;
            } else {
                (data.blocks || []).forEach(block => {
                    (block.lines || []).forEach(line => {
                        (line.spans || []).forEach(span => itemsToRender.push(span));
                    });
                });
            }
        } else {
            itemsToRender = data.lines || [];
        }

        if (itemsToRender.length === 0 && (data.lines || []).length > 0) {
            itemsToRender = data.lines;
        }

        console.log(`Rendered ${itemsToRender.length} text elements for page ${pageIndex + 1}`);

        itemsToRender.forEach((item, index) => {
            const [x0, y0, x1, y1] = item.bbox;
            const left = (x0 - pageX0) * scaleX;
            const top = (y0 - pageY0) * scaleY;
            const width = (x1 - x0) * scaleX;
            const height = (y1 - y0) * scaleY;

            if (width <= 0 || height <= 0) return;

            const box = document.createElement('div');
            box.className = 'text-element-box';
            box.id = `box-${index}`;
            box.style.left = `${left}px`;
            box.style.top = `${top}px`;
            box.style.width = `${Math.max(width, 6)}px`;
            box.style.height = `${Math.max(height, 6)}px`;
            
            // Set font size proportional to rendered scale to avoid overflow on small text
            const fontSizePx = Math.max(7, Math.round((item.size || 10) * currentScale));
            box.style.fontSize = `${fontSizePx}px`;
            box.style.lineHeight = `${Math.max(height, 6)}px`;

            // Render actual text inside DOM element for natural cursor text selection!
            box.textContent = item.text;


            box.title = `Click or select to edit: "${item.text}"`;

            // Attach metadata directly for selection & edit tracking
            box._itemData = item;
            box._pageIndex = pageIndex;
            box._scaleX = scaleX;
            box._scaleY = scaleY;

            box.addEventListener('click', (e) => {
                e.stopPropagation();
                if (isAddTextMode) {
                    handleDocClickToAddText(e);
                    return;
                }
                if (!isEditMode) return;
                const selection = window.getSelection();
                if (selection && selection.toString().trim().length > 0) {
                    // Handled by selection badge
                    return;
                }
                hideSelectionBadge();
                startInlineEditing(box, item, pageIndex, scaleX, scaleY);
            });

            box.addEventListener('dblclick', (e) => {
                e.stopPropagation();
                if (isAddTextMode || !isEditMode) return;
                hideSelectionBadge();
                startInlineEditing(box, item, pageIndex, scaleX, scaleY);
            });

            textOverlay.appendChild(box);
        });

    } catch (err) {

        console.error('Error fetching text spans:', err);
    }
}


// -------------------------------------------------------------
// Direct In-line Text Editor Logic
// -------------------------------------------------------------

function startInlineEditing(box, item, pageIndex, scaleX, scaleY) {
    if (activeInlineEditor && activeInlineEditor.boxElement === box) {
        return;
    }

    if (activeInlineEditor) {
        closeActiveInlineEditor(false);
    }

    hideSelectionBadge();

    box.classList.add('editing');

    const fontSizePx = Math.max(11, Math.round((item.size || 11) * currentScale));
    const origBoxWidth = parseFloat(box.style.width) || 60;
    const origBoxHeight = parseFloat(box.style.height) || 20;
    box.style.minHeight = `${Math.max(26, fontSizePx + 8)}px`;
    box.style.height = `${Math.max(origBoxHeight, fontSizePx + 8)}px`;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'inline-text-input';
    input.value = item.text || '';
    if (item.is_add) {
        input.placeholder = 'Type new text...';
    }

    input.style.fontSize = `${fontSizePx}px`;
    input.style.color = item.color_hex || '#000000';
    
    // Map font family and style accurately
    const fontLower = (item.font || '').toLowerCase();
    const isBold = fontLower.includes('bold') || fontLower.includes('black') || fontLower.includes('heavy');
    const isItalic = fontLower.includes('italic') || fontLower.includes('oblique');

    if (fontLower.includes('times') || fontLower.includes('serif') || fontLower.includes('georgia') || fontLower.includes('garamond') || fontLower.includes('cambria')) {
        input.style.fontFamily = 'Times New Roman, Georgia, serif';
        if (isBold && isItalic) {
            inlineFontSelect.value = 'tibi';
            input.style.fontWeight = 'bold';
            input.style.fontStyle = 'italic';
        } else if (isBold) {
            inlineFontSelect.value = 'tibo';
            input.style.fontWeight = 'bold';
            input.style.fontStyle = 'normal';
        } else if (isItalic) {
            inlineFontSelect.value = 'tiit';
            input.style.fontWeight = 'normal';
            input.style.fontStyle = 'italic';
        } else {
            inlineFontSelect.value = 'times';
            input.style.fontWeight = 'normal';
            input.style.fontStyle = 'normal';
        }
    } else if (fontLower.includes('courier') || fontLower.includes('mono') || fontLower.includes('consolas')) {
        input.style.fontFamily = 'Courier New, Courier, monospace';
        if (isBold) {
            inlineFontSelect.value = 'cobo';
            input.style.fontWeight = 'bold';
        } else {
            inlineFontSelect.value = 'couri';
            input.style.fontWeight = 'normal';
        }
        input.style.fontStyle = isItalic ? 'italic' : 'normal';
    } else {
        input.style.fontFamily = 'Arial, Helvetica, sans-serif';
        if (isBold && isItalic) {
            inlineFontSelect.value = 'hebi';
            input.style.fontWeight = 'bold';
            input.style.fontStyle = 'italic';
        } else if (isBold) {
            inlineFontSelect.value = 'hebo';
            input.style.fontWeight = 'bold';
            input.style.fontStyle = 'normal';
        } else if (isItalic) {
            inlineFontSelect.value = 'heit';
            input.style.fontWeight = 'normal';
            input.style.fontStyle = 'italic';
        } else {
            inlineFontSelect.value = 'helv';
            input.style.fontWeight = 'normal';
            input.style.fontStyle = 'normal';
        }
    }

    const initialBgColor = item.bg_color_hex || '#ffffff';
    box.style.backgroundColor = initialBgColor;

    activeInlineEditor = {
        boxElement: box,
        inputElement: input,
        itemData: item,
        pageIndex: pageIndex,
        origText: item.text || '',
        origWidth: origBoxWidth,
        origHeight: origBoxHeight,
        currentFontSize: item.size || 11,
        currentFont: inlineFontSelect.value,
        currentColorHex: item.color_hex || '#000000',
        currentBgColorHex: initialBgColor
    };

    function adjustWidth() {
        const textLength = (input.value || input.placeholder || '').length || 1;
        const charWidthEst = fontSizePx * 0.65;
        const neededWidth = Math.max(origBoxWidth, (textLength + 3) * charWidthEst, 60);
        box.style.width = `${neededWidth}px`;
    }

    input.addEventListener('input', adjustWidth);

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitInlineEdit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeActiveInlineEditor(false);
        }
    });

    box.innerHTML = '';
    box.appendChild(input);

    positionInlineToolbar(box);

    setTimeout(() => {
        input.focus();
        if (input.value) input.select();
        adjustWidth();
    }, 40);
}

function positionInlineToolbar(box) {
    const boxRect = box.getBoundingClientRect();
    const containerRect = pdfContainer.getBoundingClientRect();

    const topOffset = boxRect.top - containerRect.top - 48;
    const leftOffset = Math.max(5, Math.min(boxRect.left - containerRect.left, containerRect.width - 360));

    inlineToolbar.style.top = `${Math.max(5, topOffset)}px`;
    inlineToolbar.style.left = `${leftOffset}px`;

    inlineFontSizeVal.textContent = Math.round(activeInlineEditor.currentFontSize);
    inlineColorPicker.value = activeInlineEditor.currentColorHex;
    if (inlineBgPicker) {
        inlineBgPicker.value = activeInlineEditor.currentBgColorHex || '#ffffff';
    }

    inlineToolbar.style.display = 'flex';
}


function closeActiveInlineEditor(revert = false) {
    if (!activeInlineEditor) return;

    const { boxElement, origText, itemData } = activeInlineEditor;
    boxElement.classList.remove('editing');
    
    if (itemData && (itemData.is_add || itemData.is_image_text) && (!origText || !origText.trim())) {
        // Remove temporary placeholder box
        if (boxElement.parentNode) {
            boxElement.parentNode.removeChild(boxElement);
        }
    } else {
        boxElement.textContent = origText || '';
        boxElement.style.backgroundColor = '';
    }

    inlineToolbar.style.display = 'none';
    hideSelectionBadge();
    activeInlineEditor = null;
}



// Save in-line edit to PDF
async function commitInlineEdit() {
    if (!activeInlineEditor) return;

    const { itemData, pageIndex, inputElement, currentFontSize, currentFont, currentColorHex, currentBgColorHex } = activeInlineEditor;
    const newText = inputElement.value;

    if ((itemData.is_add || itemData.is_image_text) && !newText.trim()) {
        // If user didn't type anything in add/image text mode, just close
        closeActiveInlineEditor(false);
        return;
    }

    closeActiveInlineEditor(false);
    showToast('Saving changes directly to PDF...', 0);

    try {
        const colorRgb = hexToRgb01(currentColorHex);
        const bgColorRgb = hexToRgb01(currentBgColorHex || '#ffffff');
        const isAddMode = Boolean(itemData.is_add);

        const result = await safeJsonFetch('/edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: currentSessionId,
                page_num: pageIndex,
                mode: isAddMode ? 'add' : 'edit',
                bbox: itemData.bbox,
                origin: itemData.origin,
                new_text: newText,
                size: currentFontSize,
                font: currentFont,
                color_rgb: colorRgb,
                bg_color_rgb: bgColorRgb
            })
        });

        await loadPdfViewer();
        showToast(isAddMode ? 'New text added!' : 'Text updated successfully!', 2500);
    } catch (err) {
        hideToast();
        alert('Failed to save edit: ' + err.message);
    }
}


inlineSaveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    commitInlineEdit();
});

inlineCancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeActiveInlineEditor(false);
});

inlineFontIncrease.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!activeInlineEditor) return;
    activeInlineEditor.currentFontSize = Math.min(72, activeInlineEditor.currentFontSize + 1);
    inlineFontSizeVal.textContent = Math.round(activeInlineEditor.currentFontSize);
    const newPx = Math.round(activeInlineEditor.currentFontSize * currentScale);
    activeInlineEditor.inputElement.style.fontSize = `${newPx}px`;
});

inlineFontDecrease.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!activeInlineEditor) return;
    activeInlineEditor.currentFontSize = Math.max(6, activeInlineEditor.currentFontSize - 1);
    inlineFontSizeVal.textContent = Math.round(activeInlineEditor.currentFontSize);
    const newPx = Math.round(activeInlineEditor.currentFontSize * currentScale);
    activeInlineEditor.inputElement.style.fontSize = `${newPx}px`;
});

inlineFontSelect.addEventListener('change', (e) => {
    e.stopPropagation();
    if (!activeInlineEditor) return;
    activeInlineEditor.currentFont = inlineFontSelect.value;
    const fVal = inlineFontSelect.value;

    if (fVal === 'times') {
        activeInlineEditor.inputElement.style.fontFamily = 'Times New Roman, serif';
        activeInlineEditor.inputElement.style.fontWeight = 'normal';
        activeInlineEditor.inputElement.style.fontStyle = 'normal';
    } else if (fVal === 'tibo') {
        activeInlineEditor.inputElement.style.fontFamily = 'Times New Roman, serif';
        activeInlineEditor.inputElement.style.fontWeight = 'bold';
        activeInlineEditor.inputElement.style.fontStyle = 'normal';
    } else if (fVal === 'tiit') {
        activeInlineEditor.inputElement.style.fontFamily = 'Times New Roman, serif';
        activeInlineEditor.inputElement.style.fontWeight = 'normal';
        activeInlineEditor.inputElement.style.fontStyle = 'italic';
    } else if (fVal === 'tibi') {
        activeInlineEditor.inputElement.style.fontFamily = 'Times New Roman, serif';
        activeInlineEditor.inputElement.style.fontWeight = 'bold';
        activeInlineEditor.inputElement.style.fontStyle = 'italic';
    } else if (fVal === 'couri') {
        activeInlineEditor.inputElement.style.fontFamily = 'Courier New, Courier, monospace';
        activeInlineEditor.inputElement.style.fontWeight = 'normal';
        activeInlineEditor.inputElement.style.fontStyle = 'normal';
    } else if (fVal === 'cobo') {
        activeInlineEditor.inputElement.style.fontFamily = 'Courier New, Courier, monospace';
        activeInlineEditor.inputElement.style.fontWeight = 'bold';
        activeInlineEditor.inputElement.style.fontStyle = 'normal';
    } else if (fVal === 'hebo') {
        activeInlineEditor.inputElement.style.fontFamily = 'Arial, Helvetica, sans-serif';
        activeInlineEditor.inputElement.style.fontWeight = 'bold';
        activeInlineEditor.inputElement.style.fontStyle = 'normal';
    } else if (fVal === 'heit') {
        activeInlineEditor.inputElement.style.fontFamily = 'Arial, Helvetica, sans-serif';
        activeInlineEditor.inputElement.style.fontWeight = 'normal';
        activeInlineEditor.inputElement.style.fontStyle = 'italic';
    } else if (fVal === 'hebi') {
        activeInlineEditor.inputElement.style.fontFamily = 'Arial, Helvetica, sans-serif';
        activeInlineEditor.inputElement.style.fontWeight = 'bold';
        activeInlineEditor.inputElement.style.fontStyle = 'italic';
    } else {
        activeInlineEditor.inputElement.style.fontFamily = 'Arial, Helvetica, sans-serif';
        activeInlineEditor.inputElement.style.fontWeight = 'normal';
        activeInlineEditor.inputElement.style.fontStyle = 'normal';
    }
});

inlineColorPicker.addEventListener('input', (e) => {
    e.stopPropagation();
    if (!activeInlineEditor) return;
    activeInlineEditor.currentColorHex = inlineColorPicker.value;
    activeInlineEditor.inputElement.style.color = inlineColorPicker.value;
});

if (inlineBgPicker) {
    inlineBgPicker.addEventListener('input', (e) => {
        e.stopPropagation();
        if (!activeInlineEditor) return;
        activeInlineEditor.currentBgColorHex = inlineBgPicker.value;
        activeInlineEditor.boxElement.style.backgroundColor = inlineBgPicker.value;
        activeInlineEditor.inputElement.style.backgroundColor = inlineBgPicker.value;
    });
}


function hexToRgb01(hex) {
    let clean = (hex || '#000000').replace('#', '');
    if (clean.length === 3) {
        clean = clean.split('').map(c => c + c).join('');
    }
    const num = parseInt(clean, 16);
    return [
        ((num >> 16) & 255) / 255.0,
        ((num >> 8) & 255) / 255.0,
        (num & 255) / 255.0
    ];
}

// -------------------------------------------------------------
// Selection Action Badge & Add Text Logic
// -------------------------------------------------------------
function hideSelectionBadge() {
    if (selectionBadge) {
        selectionBadge.style.display = 'none';
    }
    currentSelectedTarget = null;
}

if (btnEditSelection) {
    btnEditSelection.addEventListener('click', (e) => {
        e.stopPropagation();
        if (currentSelectedTarget) {
            const target = currentSelectedTarget;
            hideSelectionBadge();
            startInlineEditing(target.box, target.item, target.pageIndex, target.scaleX, target.scaleY);
        }
    });
}

// Mouse text selection listener (cursor highlight on document)
document.addEventListener('mouseup', (e) => {
    if (activeInlineEditor || isAddTextMode || !isEditMode) return;
    if (e.target.closest('#inline-toolbar') || e.target.closest('#selection-badge')) return;

    setTimeout(() => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            hideSelectionBadge();
            return;
        }

        const selectedText = selection.toString().trim();
        if (selectedText.length === 0) {
            hideSelectionBadge();
            return;
        }

        const range = selection.getRangeAt(0);
        const containerNode = range.commonAncestorContainer;
        const element = containerNode.nodeType === Node.TEXT_NODE ? containerNode.parentElement : containerNode;
        const box = element ? element.closest('.text-element-box') : null;

        if (box && box._itemData) {
            const rect = range.getBoundingClientRect();
            const containerRect = pdfContainer.getBoundingClientRect();

            const topOffset = rect.top - containerRect.top - 38;
            const leftOffset = rect.left - containerRect.left + (rect.width / 2) - 65;

            selectionBadge.style.top = `${Math.max(8, topOffset)}px`;
            selectionBadge.style.left = `${Math.max(8, Math.min(leftOffset, containerRect.width - 160))}px`;
            selectionBadge.style.display = 'block';

            currentSelectedTarget = {
                box: box,
                item: box._itemData,
                pageIndex: box._pageIndex,
                scaleX: box._scaleX,
                scaleY: box._scaleY
            };
        } else {
            hideSelectionBadge();
        }
    }, 30);
});

// -------------------------------------------------------------
// Add Text Mode
// -------------------------------------------------------------
function handleDocClickToAddText(e) {
    if (!currentPageData) return;

    const rect = pdfContainer.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const clickY = e.clientY - rect.top;

    const scaleX = pdfCanvas.width / currentPageData.page_width;
    const scaleY = pdfCanvas.height / currentPageData.page_height;

    const docX = (clickX / scaleX) + (currentPageData.page_x0 || 0);
    const docY = (clickY / scaleY) + (currentPageData.page_y0 || 0);

    isAddTextMode = false;
    btnAddTextMode.classList.remove('active');
    workspace.classList.remove('add-text-cursor');

    // Create a temporary text element box at click position with is_add flag
    const tempItem = {
        is_add: true,
        bbox: [docX, docY, docX + 80, docY + 16],
        origin: [docX, docY + 12],
        text: '',
        size: 12,
        font: 'helv',
        color_hex: '#000000'
    };

    const tempBox = document.createElement('div');
    tempBox.className = 'text-element-box';
    tempBox.style.left = `${clickX}px`;
    tempBox.style.top = `${clickY}px`;
    tempBox.style.width = '140px';
    tempBox.style.height = '24px';
    textOverlay.appendChild(tempBox);

    startInlineEditing(tempBox, tempItem, currentPageNum - 1, scaleX, scaleY);
}

btnAddTextMode.addEventListener('click', () => {
    isAddTextMode = !isAddTextMode;
    btnAddTextMode.classList.toggle('active', isAddTextMode);
    workspace.classList.toggle('add-text-cursor', isAddTextMode);

    if (isAddTextMode && isImageTextMode) {
        isImageTextMode = false;
        if (btnImageTextMode) btnImageTextMode.classList.remove('active');
        workspace.classList.remove('image-text-cursor');
    }

    if (isAddTextMode) {
        showToast('Click anywhere on the document to type new text', 2500);
    }
});


pdfCanvas.addEventListener('click', (e) => {
    if (isAddTextMode) {
        handleDocClickToAddText(e);
    }
});

// -------------------------------------------------------------
// Edit Image Text Mode (Drag marquee to replace text in images/scans)
// -------------------------------------------------------------
if (btnImageTextMode) {
    btnImageTextMode.addEventListener('click', () => {
        isImageTextMode = !isImageTextMode;
        btnImageTextMode.classList.toggle('active', isImageTextMode);
        workspace.classList.toggle('image-text-cursor', isImageTextMode);

        if (isImageTextMode && isAddTextMode) {
            isAddTextMode = false;
            btnAddTextMode.classList.remove('active');
            workspace.classList.remove('add-text-cursor');
        }

        if (isImageTextMode) {
            showToast('Drag a box directly over any text in an image or diagram to replace it', 3500);
        }
    });
}

pdfContainer.addEventListener('mousedown', (e) => {
    if (!isImageTextMode || !currentPageData) return;
    if (e.target.closest('#inline-toolbar') || e.target.closest('#selection-badge')) return;

    isImageDragging = true;
    const rect = pdfContainer.getBoundingClientRect();
    imageDragStartX = e.clientX - rect.left;
    imageDragStartY = e.clientY - rect.top;

    imageDragMarquee.style.left = `${imageDragStartX}px`;
    imageDragMarquee.style.top = `${imageDragStartY}px`;
    imageDragMarquee.style.width = '0px';
    imageDragMarquee.style.height = '0px';
    imageDragMarquee.style.display = 'block';
});

window.addEventListener('mousemove', (e) => {
    if (!isImageDragging || !isImageTextMode) return;

    const rect = pdfContainer.getBoundingClientRect();
    const currentX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const currentY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const left = Math.min(imageDragStartX, currentX);
    const top = Math.min(imageDragStartY, currentY);
    const width = Math.abs(currentX - imageDragStartX);
    const height = Math.abs(currentY - imageDragStartY);

    imageDragMarquee.style.left = `${left}px`;
    imageDragMarquee.style.top = `${top}px`;
    imageDragMarquee.style.width = `${width}px`;
    imageDragMarquee.style.height = `${height}px`;
});

window.addEventListener('mouseup', (e) => {
    if (!isImageDragging || !isImageTextMode) return;
    isImageDragging = false;
    imageDragMarquee.style.display = 'none';

    const rect = pdfContainer.getBoundingClientRect();
    const endX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const endY = Math.max(0, Math.min(e.clientY - rect.top, rect.height));

    const left = Math.min(imageDragStartX, endX);
    const top = Math.min(imageDragStartY, endY);
    const width = Math.abs(endX - imageDragStartX);
    const height = Math.abs(endY - imageDragStartY);

    if (width < 10 || height < 8) return;

    const scaleX = pdfCanvas.width / currentPageData.page_width;
    const scaleY = pdfCanvas.height / currentPageData.page_height;

    const docX0 = (left / scaleX) + (currentPageData.page_x0 || 0);
    const docY0 = (top / scaleY) + (currentPageData.page_y0 || 0);
    const docX1 = ((left + width) / scaleX) + (currentPageData.page_x0 || 0);
    const docY1 = ((top + height) / scaleY) + (currentPageData.page_y0 || 0);

    isImageTextMode = false;
    if (btnImageTextMode) btnImageTextMode.classList.remove('active');
    workspace.classList.remove('image-text-cursor');

    const estimatedFontSize = Math.max(8, Math.round((docY1 - docY0) * 0.78));

    const tempItem = {
        is_image_text: true,
        bbox: [docX0, docY0, docX1, docY1],
        origin: [docX0, docY0 + (docY1 - docY0) * 0.82],
        text: '',
        size: estimatedFontSize,
        font: 'helv',
        color_hex: '#000000',
        bg_color_hex: '#ffffff'
    };

    const tempBox = document.createElement('div');
    tempBox.className = 'text-element-box';
    tempBox.style.left = `${left}px`;
    tempBox.style.top = `${top}px`;
    tempBox.style.width = `${width}px`;
    tempBox.style.height = `${height}px`;
    textOverlay.appendChild(tempBox);

    startInlineEditing(tempBox, tempItem, currentPageNum - 1, scaleX, scaleY);
});


// UI Toggles
if (toggleEditModeBtn) {
    toggleEditModeBtn.addEventListener('click', () => {
        isEditMode = !isEditMode;
        toggleEditModeBtn.classList.toggle('active', isEditMode);
        if (editModeBtnLabel) {
            editModeBtnLabel.textContent = isEditMode ? 'Edit Mode: ON' : 'Edit Mode: OFF';
        }
        textOverlay.classList.toggle('edit-mode-disabled', !isEditMode);

        if (!isEditMode) {
            closeActiveInlineEditor(false);
            hideSelectionBadge();
            showToast('Edit Mode: OFF (Viewing Mode)', 2000);
        } else {
            showToast('Edit Mode: ON — Click or select any text to edit', 2000);
        }
    });
}


toggleHighlightsBtn.addEventListener('click', () => {
    showOutlines = !showOutlines;
    toggleHighlightsBtn.classList.toggle('active', showOutlines);
    textOverlay.classList.toggle('highlights-visible', showOutlines);
});


modeLinesBtn.addEventListener('click', () => {
    currentPrecisionMode = 'lines';
    modeLinesBtn.classList.add('active');
    modeWordsBtn.classList.remove('active');
    if (currentPdfDoc) renderPage(currentPageNum);
});

modeWordsBtn.addEventListener('click', () => {
    currentPrecisionMode = 'words';
    modeWordsBtn.classList.add('active');
    modeLinesBtn.classList.remove('active');
    if (currentPdfDoc) renderPage(currentPageNum);
});

// Navigation
prevPageBtn.addEventListener('click', () => {
    if (currentPageNum > 1) {
        currentPageNum--;
        renderPage(currentPageNum);
    }
});

nextPageBtn.addEventListener('click', () => {
    if (currentPageNum < totalPages) {
        currentPageNum++;
        renderPage(currentPageNum);
    }
});

// Zoom
zoomInBtn.addEventListener('click', () => {
    if (currentScale < 3.0) {
        currentScale += 0.25;
        zoomLevelSpan.textContent = `${Math.round(currentScale * 100)}%`;
        renderPage(currentPageNum);
    }
});

zoomOutBtn.addEventListener('click', () => {
    if (currentScale > 0.5) {
        currentScale -= 0.25;
        zoomLevelSpan.textContent = `${Math.round(currentScale * 100)}%`;
        renderPage(currentPageNum);
    }
});

// Download PDF
downloadBtn.addEventListener('click', () => {
    if (!currentSessionId) return;
    window.location.href = `/download/${currentSessionId}`;
});

