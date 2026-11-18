terraform {
  required_version = ">= 1.17.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "6.71.0"
    }
  }

  # Launchbay runs this root once per service, each with its own state file:
  #   terraform init -backend-config=path=<state dir>/<service>.tfstate
  backend "local" {}
}
