# Setup and recovery

Only use this reference when dependencies are missing or maintaining the skill.

```sh
python3 -m venv SKILL_DIR/.venv
SKILL_DIR/.venv/bin/pip install -r SKILL_DIR/requirements.txt
```

OCR is optional and local. Install Tesseract and the required language data using
the operating system package manager. Check `tesseract --list-langs`; `eng` is
English and `ita` Italian. `TESSDATA_PREFIX`, if set, must point at the directory
containing the `.traineddata` files. PyMuPDF uses the same directory. Without
that override, the helpers prefer `~/.local/share/pi-pdf/tessdata` when it contains
all requested languages, then fall back to Tesseract defaults. English data was
installed locally from the official [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast)
repository for this setup; language weights are not tracked in chezmoi. Do not
substitute a hosted OCR service when data is missing.

Regression checks use generated documents:

```sh
SKILL_DIR/.venv/bin/python -B -m unittest discover -s SKILL_DIR/tests -v
```
