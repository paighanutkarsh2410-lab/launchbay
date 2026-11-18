variable "service" {
  description = "The launched service these resources belong to."
  type        = string

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,38}[a-z0-9]$", var.service))
    error_message = "Use the service's Launchbay name: 3-40 lowercase letters, digits and hyphens."
  }
}

variable "owner" {
  description = "Team that owns the service; tagged on every resource."
  type        = string
}

variable "resources" {
  description = "Which resources the service asked for: any of bucket, queue, table."
  type        = set(string)
  default     = []

  validation {
    condition     = alltrue([for r in var.resources : contains(["bucket", "queue", "table"], r)])
    error_message = "Resources must be bucket, queue or table."
  }
}

variable "region" {
  description = "AWS region."
  type        = string
  default     = "us-east-1"
}

variable "endpoint" {
  description = "Where Terraform sends AWS calls. Set it to the local emulator; leave null for real AWS."
  type        = string
  default     = null
}

variable "service_endpoint" {
  description = "Where the service's pods reach the emulator (inside the cluster). Null for real AWS."
  type        = string
  default     = null
}
