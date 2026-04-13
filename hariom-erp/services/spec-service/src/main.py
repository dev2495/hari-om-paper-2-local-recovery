from fastapi import FastAPI, Request


app = FastAPI(title="Hari Om Paper Spec Service", version="1.0.0")


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "spec-service", "status": "healthy"}


@app.get("/health")
async def health() -> dict[str, str]:
    return {"service": "spec-service", "status": "healthy"}


@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def placeholder(path: str, request: Request) -> dict[str, str]:
    return {
        "service": "spec-service",
        "status": "stub",
        "path": path,
        "method": request.method,
    }
