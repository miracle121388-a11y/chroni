# Document intake fixtures

`assignment-slide.png`, `.gif`, `.tiff` and `assignment-multipage.tiff` are synthetic course notices generated for parser regression tests. They contain no real student records, submission URLs or uploaded user documents. Their Chinese heading, separate requirement lines, filename and `24:00` deadline reproduce the layout characteristics of a course slide.

The tests construct genuine DOCX, PPTX, XLSX, OpenDocument and PDF containers from synthetic content. PDF coverage includes native text, image-only pages, mixed native/scanned pages and an image with a small text overlay. OCR runs with bundled language data and a fresh cache.
