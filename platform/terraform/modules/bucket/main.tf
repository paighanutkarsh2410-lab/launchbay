# A private S3 bucket: encrypted with the service's KMS key, versioned, never public.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

variable "name" {
  description = "Bucket name (globally unique on AWS)."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key that encrypts every object."
  type        = string
}

resource "aws_s3_bucket" "this" {
  bucket = var.name
  # Decommissioning a service removes its data too.
  force_destroy = true

  lifecycle {
    # Tags are set at creation. The AWS provider reads bucket tags back through S3 Control,
    # which the local emulator does not implement, so re-applies would re-tag every time.
    ignore_changes = [tags_all]
  }
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn
    }
    bucket_key_enabled = true
  }
}

output "name" {
  value = aws_s3_bucket.this.bucket
}

output "arn" {
  value = aws_s3_bucket.this.arn
}
