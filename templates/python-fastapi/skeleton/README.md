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

## Cloud resources

If you asked for cloud resources at launch, Launchbay provisioned them with Terraform and set
these variables on the deployment:

| Variable | Resource |
|---|---|
| `LAUNCHBAY_BUCKET` | S3 bucket (private, versioned, KMS-encrypted) |
| `LAUNCHBAY_QUEUE_URL` | SQS queue with a dead-letter queue |
| `LAUNCHBAY_TABLE` | DynamoDB table keyed by `pk` and `sk` |

`GET /cloud` reports each one and whether the service can reach it.
