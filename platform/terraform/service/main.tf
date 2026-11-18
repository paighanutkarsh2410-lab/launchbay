# Cloud resources for one launched service. Every resource is encrypted with a KMS key that
# belongs to the service alone, and tagged with the service and its owner.

locals {
  emulated = var.endpoint != null
  wants    = { for r in ["bucket", "queue", "table"] : r => contains(var.resources, r) }
  any      = length(var.resources) > 0
}

provider "aws" {
  region = var.region

  # Against the emulator, send every call there and skip checks that need real AWS.
  skip_credentials_validation = local.emulated
  skip_metadata_api_check     = true
  s3_use_path_style           = local.emulated

  endpoints {
    dynamodb  = var.endpoint
    kms       = var.endpoint
    s3        = var.endpoint
    s3control = var.endpoint # bucket tags
    sqs       = var.endpoint
    sts       = var.endpoint
  }

  default_tags {
    tags = {
      "launchbay.dev/service" = var.service
      "launchbay.dev/owner"   = var.owner
      "managed-by"            = "launchbay"
    }
  }
}

data "aws_caller_identity" "current" {}

resource "aws_kms_key" "service" {
  count                   = local.any ? 1 : 0
  description             = "Launchbay: encrypts the data of ${var.service}"
  enable_key_rotation     = true
  deletion_window_in_days = 7
}

resource "aws_kms_alias" "service" {
  count         = local.any ? 1 : 0
  name          = "alias/launchbay/${var.service}"
  target_key_id = aws_kms_key.service[0].key_id
}

module "bucket" {
  source      = "../modules/bucket"
  count       = local.wants.bucket ? 1 : 0
  name        = "${var.service}-${data.aws_caller_identity.current.account_id}"
  kms_key_arn = aws_kms_key.service[0].arn
}

module "queue" {
  source      = "../modules/queue"
  count       = local.wants.queue ? 1 : 0
  name        = var.service
  kms_key_arn = aws_kms_key.service[0].arn
}

module "table" {
  source      = "../modules/table"
  count       = local.wants.table ? 1 : 0
  name        = var.service
  kms_key_arn = aws_kms_key.service[0].arn
}
