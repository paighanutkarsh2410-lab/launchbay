# An on-demand DynamoDB table keyed for single-table design (pk + sk), encrypted with the
# service's KMS key and with point-in-time recovery on.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

variable "name" {
  description = "Table name."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key that encrypts the table."
  type        = string
}

resource "aws_dynamodb_table" "this" {
  name         = var.name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "pk"
  range_key    = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled     = true
    kms_key_arn = var.kms_key_arn
  }
}

output "name" {
  value = aws_dynamodb_table.this.name
}

output "arn" {
  value = aws_dynamodb_table.this.arn
}
