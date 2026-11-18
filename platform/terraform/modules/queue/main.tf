# An encrypted SQS queue with a dead-letter queue for messages that keep failing.

terraform {
  required_providers {
    aws = { source = "hashicorp/aws" }
  }
}

variable "name" {
  description = "Queue name. The dead-letter queue is <name>-dlq."
  type        = string
}

variable "kms_key_arn" {
  description = "KMS key that encrypts messages at rest."
  type        = string
}

variable "max_receive_count" {
  description = "Deliveries before a message moves to the dead-letter queue."
  type        = number
  default     = 5
}

resource "aws_sqs_queue" "dead_letter" {
  name                      = "${var.name}-dlq"
  kms_master_key_id         = var.kms_key_arn
  message_retention_seconds = 1209600 # 14 days, the maximum, to give time to investigate
}

resource "aws_sqs_queue" "this" {
  name                              = var.name
  kms_master_key_id                 = var.kms_key_arn
  kms_data_key_reuse_period_seconds = 300

  lifecycle {
    # Owned by aws_sqs_queue_redrive_policy below.
    ignore_changes = [redrive_policy]
  }
}

# A separate resource rather than the queue's inline redrive_policy, which the emulator echoes
# back with different JSON whitespace and so shows as a change on every apply.
resource "aws_sqs_queue_redrive_policy" "this" {
  queue_url = aws_sqs_queue.this.id
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letter.arn
    maxReceiveCount     = var.max_receive_count
  })
}

output "name" {
  value = aws_sqs_queue.this.name
}

output "arn" {
  value = aws_sqs_queue.this.arn
}

output "dead_letter_arn" {
  value = aws_sqs_queue.dead_letter.arn
}
