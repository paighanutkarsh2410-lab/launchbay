import os

from fastapi import FastAPI

from app import cloud

app = FastAPI(title="[[name]]")


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/")
def root() -> dict:
    return {"service": "[[name]]", "message": "Launched with Launchbay"}


@app.get("/cloud")
def cloud_resources() -> dict:
    """The cloud resources Launchbay provisioned for this service, and whether each answers."""
    return {"region": os.environ.get("AWS_REGION"), "resources": cloud.check_all()}
