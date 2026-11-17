from fastapi import FastAPI

app = FastAPI(title="[[name]]")


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/")
def root() -> dict:
    return {"service": "[[name]]", "message": "Launched with Launchbay"}
