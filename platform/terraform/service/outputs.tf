locals {
  account = data.aws_caller_identity.current.account_id
  # The service's pods reach SQS through service_endpoint, not the address Terraform used.
  queue_url = (
    !local.wants.queue ? null :
    var.service_endpoint != null ? "${var.service_endpoint}/${local.account}/${module.queue[0].name}" :
    "https://sqs.${var.region}.amazonaws.com/${local.account}/${module.queue[0].name}"
  )
}

output "env" {
  description = "Environment variables the service is deployed with."
  value = merge(
    local.any ? { AWS_REGION = var.region } : {},
    local.any && var.service_endpoint != null ? { AWS_ENDPOINT_URL = var.service_endpoint } : {},
    local.wants.bucket ? { LAUNCHBAY_BUCKET = module.bucket[0].name } : {},
    local.wants.queue ? { LAUNCHBAY_QUEUE_URL = local.queue_url } : {},
    local.wants.table ? { LAUNCHBAY_TABLE = module.table[0].name } : {},
  )
}

output "resources" {
  description = "What was provisioned, for the portal."
  value = concat(
    local.any ? [{ kind = "key", name = aws_kms_alias.service[0].name, arn = aws_kms_key.service[0].arn }] : [],
    local.wants.bucket ? [{ kind = "bucket", name = module.bucket[0].name, arn = module.bucket[0].arn }] : [],
    local.wants.queue ? [{ kind = "queue", name = module.queue[0].name, arn = module.queue[0].arn }] : [],
    local.wants.table ? [{ kind = "table", name = module.table[0].name, arn = module.table[0].arn }] : [],
  )
}
