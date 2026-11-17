# [[name]]

[[description]]

Launched with [Launchbay](https://github.com/paighanutkarsh2410-lab/launchbay) from the **Python API** template.

## Run locally

```bash
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
pytest
```

## Delivery

Every push to `main` is tested, scanned with Trivy, built, pushed to GHCR and signed with cosign.
Launchbay's GitOps repo points Argo CD at the image, and the service is served at
`http://[[name]].localtest.me`.
