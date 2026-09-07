import fitz

pdf_path = "uploads/994b07a0-b02f-4f0c-8316-5b06177b204a.pdf"
doc = fitz.open(pdf_path)
out = []
out.append(f"Pages: {len(doc)}")

for i in range(min(len(doc), 5)):
    page = doc[i]
    out.append(f"\n--- Page {i+1} ---")
    out.append(f"Rect: {page.rect}")
    out.append(f"Rotation: {page.rotation}")
    text = page.get_text()
    out.append(f"Text length: {len(text)}")
    out.append(f"First 200 chars: {repr(text[:200])}")
    
    # Check text blocks
    blocks = page.get_text("blocks")
    out.append(f"Number of text blocks: {len(blocks)}")
    if blocks:
        out.append(f"Sample block: {blocks[0]}")
    
    # Check images
    images = page.get_images()
    out.append(f"Images count: {len(images)}")

with open("pdf_debug.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(out))

print("Done")
