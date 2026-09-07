import os
import io
import uuid
from flask import Flask, request, jsonify, render_template, send_file
import fitz  # PyMuPDF

app = Flask(__name__)
import json
import tempfile

UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads'))
try:
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)
except Exception:
    UPLOAD_FOLDER = os.path.join(tempfile.gettempdir(), 'pdf_editor_uploads')
    os.makedirs(UPLOAD_FOLDER, exist_ok=True)

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024  # 100 MB max

sessions = {}

def get_session_pdf_path(session_id):
    if not session_id:
        return None
    session = sessions.get(session_id)
    if session and os.path.exists(session.get('path', '')):
        return session['path']
    candidate = os.path.join(app.config['UPLOAD_FOLDER'], f"{session_id}.pdf")
    if os.path.exists(candidate):
        return candidate
    # Also check /tmp fallback
    tmp_candidate = os.path.join(tempfile.gettempdir(), f"{session_id}.pdf")
    if os.path.exists(tmp_candidate):
        return tmp_candidate
    return None

def save_session_meta(session_id, filename):
    meta_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{session_id}.json")
    try:
        with open(meta_path, 'w', encoding='utf-8') as f:
            json.dump({'filename': filename}, f)
    except Exception:
        pass

def get_session_filename(session_id):
    meta_path = os.path.join(app.config['UPLOAD_FOLDER'], f"{session_id}.json")
    if os.path.exists(meta_path):
        try:
            with open(meta_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                return data.get('filename', 'edited_document.pdf')
        except Exception:
            pass
    return sessions.get(session_id, {}).get('filename', 'edited_document.pdf')

BASE14_FONTS = {
    'helv', 'hebo', 'heit', 'hebi',
    'times', 'tibo', 'tiit', 'tibi',
    'couri', 'cobo', 'coit', 'cobi',
    'symb', 'zadb'
}

def get_font_candidate(font_name):
    if not font_name:
        return 'helv'
    
    clean = str(font_name).strip().lower()
    if clean in BASE14_FONTS:
        return clean
    
    # Check Times / Serif
    if any(k in clean for k in ['times', 'serif', 'georgia', 'garamond', 'cambria', 'roman']):
        if ('bold' in clean or 'black' in clean) and ('italic' in clean or 'oblique' in clean):
            return 'tibi'
        elif 'bold' in clean or 'black' in clean or 'heavy' in clean:
            return 'tibo'
        elif 'italic' in clean or 'oblique' in clean:
            return 'tiit'
        return 'times'
    
    # Check Courier / Monospace
    if any(k in clean for k in ['courier', 'mono', 'consolas', 'code', 'typewriter']):
        if ('bold' in clean or 'black' in clean) and ('italic' in clean or 'oblique' in clean):
            return 'cobi'
        elif 'bold' in clean or 'black' in clean or 'heavy' in clean:
            return 'cobo'
        elif 'italic' in clean or 'oblique' in clean:
            return 'coit'
        return 'couri'
    
    # Sans-serif (Arial, Helvetica, Calibri, Roboto, Segoe, Open Sans, etc.)
    if ('bold' in clean or 'black' in clean or 'heavy' in clean) and ('italic' in clean or 'oblique' in clean):
        return 'hebi'
    elif 'bold' in clean or 'black' in clean or 'heavy' in clean:
        return 'hebo'
    elif 'italic' in clean or 'oblique' in clean:
        return 'heit'
    
FONT_NAME_MAP = {
    'helv': ('helv', 'Helvetica', 'Arial'),
    'hebo': ('hebo', 'Helvetica-Bold', 'Arial-Bold', 'Helvetica,Bold'),
    'heit': ('heit', 'Helvetica-Oblique', 'Arial-Italic', 'Helvetica,Italic'),
    'hebi': ('hebi', 'Helvetica-BoldOblique', 'Arial-BoldItalic'),
    'times': ('times', 'Times-Roman', 'TimesNewRoman', 'Times'),
    'tibo': ('tibo', 'Times-Bold', 'TimesNewRoman-Bold', 'Times,Bold'),
    'tiit': ('tiit', 'Times-Italic', 'TimesNewRoman-Italic', 'Times,Italic'),
    'tibi': ('tibi', 'Times-BoldItalic', 'TimesNewRoman-BoldItalic'),
    'couri': ('couri', 'Courier', 'CourierNew'),
    'cobo': ('cobo', 'Courier-Bold', 'CourierNew-Bold', 'Courier,Bold'),
    'coit': ('coit', 'Courier-Oblique', 'CourierNew-Italic', 'Courier,Italic'),
    'cobi': ('cobi', 'Courier-BoldOblique', 'CourierNew-BoldItalic')
}

def safe_insert_text(page, point, text, fontsize, fontname, color, rect=None, align='left'):
    candidate = get_font_candidate(fontname)
    fs = float(fontsize)
    c = color if isinstance(color, (list, tuple)) and len(color) == 3 else (0, 0, 0)
    
    # Calculate horizontal alignment offset if rect is provided
    x = point.x
    if rect is not None and align in ('center', 'right'):
        try:
            text_len = fitz.get_text_length(text, fontname=candidate, fontsize=fs)
        except Exception:
            text_len = len(text) * fs * 0.55
        
        if align == 'right':
            x = rect.x1 - text_len
        elif align == 'center':
            x = rect.x0 + max(0, (rect.width - text_len) / 2)
            
    final_point = fitz.Point(x, point.y)

    # Attempt font name and all supported aliases for this style
    aliases = FONT_NAME_MAP.get(candidate, (candidate,))
    for alias in aliases:
        try:
            page.insert_text(final_point, text, fontsize=fs, fontname=alias, color=c)
            return
        except Exception:
            pass

    # Fallback to bold Helvetica if bold, else regular
    fallback_font = 'hebo' if 'bo' in candidate or 'bi' in candidate else 'helv'
    try:
        page.insert_text(final_point, text, fontsize=fs, fontname=fallback_font, color=c)
        return
    except Exception:
        pass

    # PyMuPDF default
    try:
        page.insert_text(final_point, text, fontsize=fs, color=c)
        return
    except Exception:
        pass

    # Textbox alignment fallback
    if rect is not None:
        try:
            al = fitz.TEXT_ALIGN_RIGHT if align == 'right' else (fitz.TEXT_ALIGN_CENTER if align == 'center' else fitz.TEXT_ALIGN_LEFT)
            page.insert_textbox(rect, text, fontsize=fs, color=c, align=al)
        except Exception:
            pass

def safe_apply_redactions(page):
    # CRITICAL: Always use images=PDF_REDACT_IMAGE_NONE first!
    # This prevents PyMuPDF from re-encoding/decompressing large or bulk images,
    # making text editing instant and 100% reliable on image-heavy pages.
    try:
        img_none = getattr(fitz, 'PDF_REDACT_IMAGE_NONE', 0)
        page.apply_redactions(images=img_none)
        return
    except Exception:
        pass

    try:
        page.apply_redactions()
    except Exception:
        pass


@app.route('/')
def index():
    return render_template('index.html')

@app.route('/upload', methods=['POST'])
def upload_pdf():
    if 'file' not in request.files:
        return jsonify({'error': 'No file part provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'No file selected'}), 400
    
    if not file.filename.lower().endswith('.pdf'):
        return jsonify({'error': 'Only PDF files are allowed'}), 400
    
    session_id = str(uuid.uuid4())
    saved_filename = f"{session_id}.pdf"
    saved_path = os.path.join(app.config['UPLOAD_FOLDER'], saved_filename)
    
    try:
        file_bytes = file.read()
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        page_count = len(doc)
        doc.close()
        
        with open(saved_path, 'wb') as f:
            f.write(file_bytes)
    except Exception as e:
        if os.path.exists(saved_path):
            try:
                os.remove(saved_path)
            except Exception:
                pass
        return jsonify({'error': f'Invalid or corrupted PDF: {str(e)}'}), 400
    
    sessions[session_id] = {
        'path': saved_path,
        'filename': file.filename
    }
    save_session_meta(session_id, file.filename)
    
    return jsonify({
        'session_id': session_id,
        'filename': file.filename,
        'page_count': page_count
    })

@app.route('/pdf/<session_id>')
def serve_pdf(session_id):
    path = get_session_pdf_path(session_id)
    if not path:
        return jsonify({'error': 'Session not found'}), 404
    
    try:
        return send_file(path, mimetype='application/pdf')
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/text-blocks/<session_id>/<int:page_num>')
def get_text_blocks(session_id, page_num):
    path = get_session_pdf_path(session_id)
    if not path:
        return jsonify({'error': 'Session not found'}), 404

    try:
        with open(path, 'rb') as f:
            pdf_bytes = f.read()
            
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        if page_num < 0 or page_num >= len(doc):
            doc.close()
            return jsonify({'error': 'Page out of range'}), 400

        page = doc[page_num]
        rect = page.rect
        page_width = rect.width
        page_height = rect.height
        page_x0 = rect.x0
        page_y0 = rect.y0
        rotation = page.rotation

        # Extract text dictionary with flags to skip heavy image binary serialization
        try:
            flags = fitz.TEXT_PRESERVE_LIGATURES | fitz.TEXT_PRESERVE_WHITESPACE
            page_dict = page.get_text("dict", flags=flags)
        except Exception:
            page_dict = page.get_text("dict")

        blocks = []
        flat_lines = []
        flat_words = []

        # High-precision word extraction for small font text and dense layouts
        try:
            words_raw = page.get_text("words")
            for w in words_raw:
                wx0, wy0, wx1, wy1, w_text = w[0], w[1], w[2], w[3], w[4]
                b_no, l_no, w_no = w[5], w[6], w[7]
                if w_text and w_text.strip():
                    w_height = max(wy1 - wy0, 6.0)
                    flat_words.append({
                        'id': f"w_{b_no}_{l_no}_{w_no}",
                        'text': w_text,
                        'bbox': [wx0, wy0, wx1, wy1],
                        'origin': [wx0, wy1],
                        'size': round(w_height, 1),
                        'font': 'helv',
                        'color_rgb': [0, 0, 0],
                        'color_hex': '#000000'
                    })
        except Exception:
            pass

        for b_idx, block in enumerate(page_dict.get("blocks", [])):
            if block.get("type") == 0:  # Text block
                block_lines = []
                for l_idx, line in enumerate(block.get("lines", [])):
                    spans = []
                    line_text_acc = []
                    primary_size = 11
                    primary_font = "helv"
                    primary_color = [0, 0, 0]
                    primary_hex = "#000000"
                    primary_origin = None

                    for s_idx, span in enumerate(line.get("spans", [])):
                        text = span.get("text", "")
                        if not text and "chars" in span:
                            text = "".join([c.get("c", "") for c in span.get("chars", [])])

                        if not text or not text.strip():
                            continue

                        line_text_acc.append(text)
                        color_val = span.get("color", 0)
                        r = (color_val >> 16) & 255
                        g = (color_val >> 8) & 255
                        b = color_val & 255
                        color_rgb = [round(r / 255.0, 3), round(g / 255.0, 3), round(b / 255.0, 3)]
                        color_hex = f"#{r:02x}{g:02x}{b:02x}"

                        s_bbox = list(span.get("bbox", []))
                        origin_val = list(span.get("origin", [s_bbox[0] if s_bbox else 0, s_bbox[3] if len(s_bbox) > 3 else 0]))

                        if not spans:
                            primary_size = span.get("size", 11)
                            primary_font = span.get("font", "helv")
                            primary_color = color_rgb
                            primary_hex = color_hex
                            primary_origin = origin_val

                        spans.append({
                            'id': f"b{b_idx}_l{l_idx}_s{s_idx}",
                            'text': text,
                            'bbox': s_bbox,
                            'origin': origin_val,
                            'size': span.get("size", 11),
                            'font': span.get("font", "helv"),
                            'color_rgb': color_rgb,
                            'color_hex': color_hex
                        })

                    if not spans:
                        continue

                    # Properly join words with space separation if spans don't have trailing spaces
                    parts = []
                    for t in line_text_acc:
                        if parts and not parts[-1].endswith(" ") and not t.startswith(" "):
                            parts.append(" ")
                        parts.append(t)
                    full_line_text = "".join(parts).strip()

                    # Compute accurate line bounding box even for small font size text
                    line_bbox = list(line.get("bbox", []))
                    if not line_bbox or len(line_bbox) < 4 or line_bbox[2] <= line_bbox[0] or line_bbox[3] <= line_bbox[1]:
                        x0 = min(s['bbox'][0] for s in spans)
                        y0 = min(s['bbox'][1] for s in spans)
                        x1 = max(s['bbox'][2] for s in spans)
                        y1 = max(s['bbox'][3] for s in spans)
                        line_bbox = [x0, y0, x1, y1]

                    if full_line_text:
                        # Alignment heuristic
                        line_align = 'left'
                        if page_width > 0 and len(line_bbox) >= 4:
                            right_dist = page_width - line_bbox[2]
                            left_dist = line_bbox[0]
                            if line_bbox[0] > (page_width * 0.45) and right_dist < 85:
                                line_align = 'right'
                            elif abs(right_dist - left_dist) < 35 and left_dist > 40:
                                line_align = 'center'

                        # Attach align to each span in the line
                        for s in spans:
                            s['align'] = line_align

                        line_obj = {
                            'id': f"line_{b_idx}_{l_idx}",
                            'text': full_line_text,
                            'bbox': line_bbox,
                            'origin': primary_origin or [line_bbox[0], line_bbox[3]],
                            'spans': spans,
                            'size': primary_size,
                            'font': primary_font,
                            'align': line_align,
                            'color_rgb': primary_color,
                            'color_hex': primary_hex
                        }
                        block_lines.append(line_obj)
                        flat_lines.append(line_obj)

                if block_lines:
                    blocks.append({
                        'bbox': list(block.get("bbox", [])),
                        'lines': block_lines
                    })

        # Extra fallback: if blocks extraction produced no lines, use words extraction
        if not flat_lines and flat_words:
            flat_lines = flat_words

        doc.close()

        return jsonify({
            'page_num': page_num,
            'page_width': page_width,
            'page_height': page_height,
            'page_x0': page_x0,
            'page_y0': page_y0,
            'rotation': rotation,
            'blocks': blocks,
            'lines': flat_lines,
            'words': flat_words
        })


    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/edit', methods=['POST'])
def edit_text():
    data = request.get_json() or {}
    session_id = data.get('session_id')
    page_num = data.get('page_num', 0)
    mode = data.get('mode', 'edit')  # 'edit' (replaces existing text), 'add' (inserts new text), or 'erase' (whiteout/delete)
    bbox = data.get('bbox')  # [x0, y0, x1, y1]
    origin = data.get('origin')  # [ox, oy] text baseline
    new_text = data.get('new_text', '')
    font_size = data.get('size', 11)
    color_rgb = data.get('color_rgb', [0, 0, 0])
    font_name = data.get('font', 'helv')
    align = data.get('align', 'left')  # 'left', 'center', 'right'

    path = get_session_pdf_path(session_id)
    if not path:
        return jsonify({'error': 'Session not found'}), 404

    try:
        with open(path, 'rb') as f:
            pdf_bytes = f.read()

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        if page_num < 0 or page_num >= len(doc):
            doc.close()
            return jsonify({'error': 'Page index out of bounds'}), 400

        page = doc[page_num]
        c = (float(color_rgb[0]), float(color_rgb[1]), float(color_rgb[2])) if len(color_rgb) == 3 else (0, 0, 0)

        if mode == 'add':
            # ADDING NEW TEXT: Never redact pre-existing text!
            x = bbox[0] if (bbox and len(bbox) >= 1) else data.get('x', 50)
            y = bbox[1] if (bbox and len(bbox) >= 2) else data.get('y', 50)
            baseline_y = y + float(font_size) * 0.82

            if new_text.strip():
                safe_insert_text(
                    page,
                    fitz.Point(x, baseline_y),
                    new_text,
                    fontsize=float(font_size),
                    fontname=font_name,
                    color=c,
                    rect=None,
                    align=align
                )
        else:
            # EDITING OR ERASING EXISTING TEXT (or Image Text):
            if bbox and len(bbox) >= 4:
                rect = fitz.Rect(bbox[0], bbox[1], bbox[2], bbox[3])

                # Background fill color (default white: [1, 1, 1])
                bg_color_rgb = data.get('bg_color_rgb', [1, 1, 1])
                bg_c = (float(bg_color_rgb[0]), float(bg_color_rgb[1]), float(bg_color_rgb[2])) if len(bg_color_rgb) == 3 else (1, 1, 1)

                # Draw filled rectangle to cleanly cover image pixels or scan graphics
                page.draw_rect(rect, color=None, fill=bg_c)

                # Also apply redaction for any vector text
                page.add_redact_annot(rect, fill=bg_c)
                safe_apply_redactions(page)

                if mode != 'erase' and new_text.strip():
                    if origin and len(origin) >= 2:
                        start_x = float(origin[0])
                        start_y = float(origin[1])
                    else:
                        start_x = float(rect.x0)
                        start_y = float(rect.y0) + float(font_size) * 0.82

                    baseline_point = fitz.Point(start_x, start_y)

                    safe_insert_text(
                        page,
                        baseline_point,
                        new_text,
                        fontsize=float(font_size),
                        fontname=font_name,
                        color=c,
                        rect=rect,
                        align=align
                    )


        new_bytes = doc.tobytes(garbage=1, deflate=True)
        doc.close()


        with open(path, 'wb') as f:
            f.write(new_bytes)

        return jsonify({'status': 'success', 'message': 'Text updated successfully'})

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/add-text', methods=['POST'])
def add_new_text():
    data = request.get_json() or {}
    session_id = data.get('session_id')
    page_num = data.get('page_num', 0)
    x = data.get('x', 50)
    y = data.get('y', 50)
    text = data.get('text', '')
    font_size = data.get('size', 12)
    font_name = data.get('font', 'helv')
    color_rgb = data.get('color_rgb', [0, 0, 0])

    if not text.strip():
        return jsonify({'error': 'Text cannot be empty'}), 400

    path = get_session_pdf_path(session_id)
    if not path:
        return jsonify({'error': 'Session not found'}), 404

    try:
        with open(path, 'rb') as f:
            pdf_bytes = f.read()

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        if page_num < 0 or page_num >= len(doc):
            doc.close()
            return jsonify({'error': 'Page index out of bounds'}), 400

        page = doc[page_num]
        c = (float(color_rgb[0]), float(color_rgb[1]), float(color_rgb[2])) if len(color_rgb) == 3 else (0, 0, 0)
        
        # Insert text at exact point without redacting surrounding area
        baseline_point = fitz.Point(x, y + float(font_size) * 0.82)
        safe_insert_text(
            page,
            baseline_point,
            text,
            fontsize=float(font_size),
            fontname=font_name,
            color=c
        )

        new_bytes = doc.tobytes(garbage=1, deflate=True)
        doc.close()


        with open(path, 'wb') as f:
            f.write(new_bytes)

        return jsonify({'status': 'success', 'message': 'New text added'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/download/<session_id>')
def download_pdf(session_id):
    path = get_session_pdf_path(session_id)
    if not path:
        return jsonify({'error': 'Session not found'}), 404

    try:
        original_filename = get_session_filename(session_id)
        name_parts = os.path.splitext(original_filename)
        download_name = f"{name_parts[0]}_edited{name_parts[1]}"

        return send_file(
            path,
            as_attachment=True,
            download_name=download_name,
            mimetype='application/pdf'
        )
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"Starting PDF Editor server on http://localhost:{port}")
    app.run(host='0.0.0.0', port=port, debug=False, use_reloader=False)
