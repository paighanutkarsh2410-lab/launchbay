"""Service templates: metadata from template.yaml, files from skeleton/."""

from dataclasses import dataclass, field
from pathlib import Path

import yaml

PLACEHOLDER = "[[{key}]]"
# Files that are copied as-is, never rendered.
BINARY_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".ico", ".woff", ".woff2"}


@dataclass(frozen=True)
class Template:
    id: str
    name: str
    description: str
    language: str
    runtime: str
    port: int
    tags: list[str] = field(default_factory=list)
    accent: str = "#7c5cff"
    path: Path = Path()

    def render(self, values: dict[str, str]) -> dict[str, bytes]:
        """Returns {relative path: content} for every file in the skeleton."""
        skeleton = self.path / "skeleton"
        files: dict[str, bytes] = {}
        for file in sorted(p for p in skeleton.rglob("*") if p.is_file()):
            relative = file.relative_to(skeleton).as_posix()
            data = file.read_bytes()
            if file.suffix.lower() not in BINARY_SUFFIXES:
                text = data.decode("utf-8")
                for key, value in values.items():
                    text = text.replace(PLACEHOLDER.format(key=key), value)
                    relative = relative.replace(PLACEHOLDER.format(key=key), value)
                data = text.encode("utf-8")
            files[relative] = data
        return files


class TemplateCatalog:
    def __init__(self, root: Path) -> None:
        self.root = root
        self._templates: dict[str, Template] = {}
        self.reload()

    def reload(self) -> None:
        templates = {}
        for meta in sorted(self.root.glob("*/template.yaml")):
            raw = yaml.safe_load(meta.read_text(encoding="utf-8"))
            template = Template(
                id=meta.parent.name,
                name=raw["name"],
                description=raw["description"],
                language=raw["language"],
                runtime=raw["runtime"],
                port=int(raw["port"]),
                tags=list(raw.get("tags", [])),
                accent=raw.get("accent", "#7c5cff"),
                path=meta.parent,
            )
            templates[template.id] = template
        self._templates = templates

    def all(self) -> list[Template]:
        return list(self._templates.values())

    def get(self, template_id: str) -> Template | None:
        return self._templates.get(template_id)
