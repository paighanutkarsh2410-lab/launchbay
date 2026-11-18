"""Reaches the AWS resources Launchbay provisioned for this service.

Launchbay passes them as environment variables. boto3 also reads AWS_ENDPOINT_URL, so the
same code talks to the local emulator or to real AWS without changes.
"""

import os

import boto3
from botocore.config import Config

_config = Config(connect_timeout=2, read_timeout=3, retries={"max_attempts": 1})


def _client(service: str):
    # boto3 reads AWS_DEFAULT_REGION, not the AWS_REGION Launchbay sets (as other SDKs expect).
    return boto3.client(
        service, region_name=os.environ.get("AWS_REGION"), config=_config
    )


def _check(kind: str, name: str, probe) -> dict:
    try:
        probe()
        return {"kind": kind, "name": name, "reachable": True}
    except Exception as error:  # noqa: BLE001 - report it rather than fail the request
        return {
            "kind": kind,
            "name": name,
            "reachable": False,
            "error": type(error).__name__,
        }


def check_all() -> list[dict]:
    results = []
    if bucket := os.environ.get("LAUNCHBAY_BUCKET"):
        results.append(
            _check("bucket", bucket, lambda: _client("s3").head_bucket(Bucket=bucket))
        )
    if queue_url := os.environ.get("LAUNCHBAY_QUEUE_URL"):
        results.append(
            _check(
                "queue",
                queue_url.rsplit("/", 1)[-1],
                lambda: _client("sqs").get_queue_attributes(QueueUrl=queue_url),
            )
        )
    if table := os.environ.get("LAUNCHBAY_TABLE"):
        results.append(
            _check(
                "table",
                table,
                lambda: _client("dynamodb").describe_table(TableName=table),
            )
        )
    return results
