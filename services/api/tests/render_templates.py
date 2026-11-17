"""Renders every template into a directory, so CI can run each template's own tests.

Usage: python tests/render_templates.py <output-dir>
"""

import sys
from pathlib import Path

from app.config import get_settings
from app.templates_catalog import TemplateCatalog

out = Path(sys.argv[1])
for template in TemplateCatalog(get_settings().templates_dir).all():
    for path, content in template.render({"name": "ci-check", "description": "CI check"}).items():
        target = out / template.id / path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    print(f"rendered {template.id}")
