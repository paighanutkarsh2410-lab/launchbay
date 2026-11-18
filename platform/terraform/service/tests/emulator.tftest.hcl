# Integration test: creates, checks and destroys real resources on the Moto emulator.
#   terraform test -filter=tests/emulator.tftest.hcl -var endpoint=http://localhost:5000
# Needs AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY set to any value (Moto accepts anything).

variables {
  service   = "tf-integration"
  owner     = "platform-team"
  resources = ["bucket", "queue", "table"]
}

run "provisions_everything_on_the_emulator" {
  assert {
    condition     = length(output.resources) == 4
    error_message = "Expected a key, a bucket, a queue and a table."
  }
  assert {
    condition     = startswith(module.queue[0].dead_letter_arn, "arn:aws:sqs:")
    error_message = "The queue needs a dead-letter queue."
  }
  assert {
    condition     = output.env.LAUNCHBAY_TABLE == "tf-integration"
    error_message = "The table name is passed to the service."
  }
}
