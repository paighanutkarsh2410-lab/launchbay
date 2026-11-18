# Unit tests: run against a mocked AWS provider. No credentials, no network.

mock_provider "aws" {
  mock_data "aws_caller_identity" {
    defaults = { account_id = "123456789012" }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:us-east-1:123456789012:key/mock" }
  }
}

variables {
  service = "pulsar-api"
  owner   = "platform-team"
}

run "no_resources_creates_nothing" {
  command = plan

  assert {
    condition     = length(aws_kms_key.service) == 0
    error_message = "A service with no resources should not get a KMS key."
  }
}

run "each_requested_resource_is_created_once" {
  command = plan
  variables {
    resources = ["bucket", "queue", "table"]
  }

  assert {
    condition     = length(module.bucket) == 1 && length(module.queue) == 1 && length(module.table) == 1
    error_message = "Each requested resource should be created once."
  }
  assert {
    condition     = aws_kms_key.service[0].enable_key_rotation
    error_message = "The service's KMS key must rotate."
  }
}

run "only_what_was_asked_for" {
  command = plan
  variables {
    resources = ["queue"]
  }

  assert {
    condition     = length(module.bucket) == 0 && length(module.table) == 0 && length(module.queue) == 1
    error_message = "Only the queue was requested."
  }
}

run "emulator_env_points_pods_inside_the_cluster" {
  command = apply
  variables {
    resources        = ["bucket", "queue"]
    endpoint         = "http://aws.localtest.me"
    service_endpoint = "http://moto.launchbay-cloud.svc.cluster.local:5000"
  }

  assert {
    condition     = output.env.AWS_ENDPOINT_URL == "http://moto.launchbay-cloud.svc.cluster.local:5000"
    error_message = "Pods must reach the emulator by its cluster address."
  }
  assert {
    condition     = output.env.LAUNCHBAY_QUEUE_URL == "http://moto.launchbay-cloud.svc.cluster.local:5000/123456789012/pulsar-api"
    error_message = "The queue URL must use the cluster address too."
  }
  assert {
    condition     = output.env.LAUNCHBAY_BUCKET == "pulsar-api-123456789012"
    error_message = "Bucket names are <service>-<account> so they are unique on AWS."
  }
  assert {
    condition     = !contains(keys(output.env), "LAUNCHBAY_TABLE")
    error_message = "No table was requested."
  }
}

run "real_aws_has_no_endpoint_override" {
  command = apply
  variables {
    resources = ["queue"]
  }

  assert {
    condition     = !contains(keys(output.env), "AWS_ENDPOINT_URL")
    error_message = "On real AWS the SDK's default endpoints are used."
  }
  assert {
    condition     = output.env.LAUNCHBAY_QUEUE_URL == "https://sqs.us-east-1.amazonaws.com/123456789012/pulsar-api"
    error_message = "Real queue URLs use the regional SQS endpoint."
  }
}

run "rejects_unknown_resources" {
  command = plan
  variables {
    resources = ["database"]
  }
  expect_failures = [var.resources]
}
