from pathlib import PurePosixPath

from starlette.exceptions import HTTPException
from starlette.staticfiles import StaticFiles
from starlette.types import Scope


_STATIC_EXTENSIONS = {
    ".js", ".css", ".png", ".jpg", ".jpeg", ".gif", ".svg",
    ".woff", ".woff2", ".ttf", ".eot", ".map", ".ico", ".webp",
}


class SPAStaticFiles(StaticFiles):
    """Serve a React SPA: static assets by extension, index.html for everything else."""

    async def get_response(self, path: str, scope: Scope):
        try:
            return await super().get_response(path, scope)
        except HTTPException as ex:
            if ex.status_code == 404:
                suffix = PurePosixPath(path).suffix.lower()
                if suffix in _STATIC_EXTENSIONS:
                    raise  # Real missing asset = real 404
                return await super().get_response("index.html", scope)
            raise
